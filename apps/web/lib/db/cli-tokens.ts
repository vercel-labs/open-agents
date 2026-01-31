import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { cliTokens, users } from "./schema";

// Token configuration
const DEVICE_CODE_EXPIRY_MINUTES = 10;
const TOKEN_EXPIRY_DAYS = 90;

// User code character set (excluding confusing characters like 0/O, 1/I/l)
const USER_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LENGTH = 8; // 4-4 format

/**
 * Hash a token or code using SHA-256
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a secure random token
 */
function generateToken(length = 64): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

/**
 * Get the encryption key from environment or generate a fallback for dev
 * In production, CLI_TOKEN_ENCRYPTION_KEY should be set to a 32-byte hex string
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.CLI_TOKEN_ENCRYPTION_KEY;
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error(
        "CLI_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
      );
    }
    return Buffer.from(envKey, "hex");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CLI_TOKEN_ENCRYPTION_KEY must be set in production");
  }

  // Fallback for development - derive from a constant (not secure for production)
  return createHash("sha256").update("dev-encryption-key").digest();
}

/**
 * Encrypt a token for temporary storage
 */
function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a token from storage
 */
function decryptToken(encryptedData: string): string | null {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
    if (!ivHex || !authTagHex || !encrypted) {
      return null;
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Generate a user-friendly code (format: XXXX-XXXX)
 */
function generateUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    const randomIndex = Math.floor(
      (randomBytes(1)[0]! / 256) * USER_CODE_CHARS.length,
    );
    code += USER_CODE_CHARS[randomIndex];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Normalize user code input (remove dashes, uppercase)
 */
export function normalizeUserCode(code: string): string {
  return code.replace(/-/g, "").toUpperCase();
}

export interface DeviceFlowResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

/**
 * Start a new device flow authentication
 * Note: Access token is generated later during verification, not here
 */
export async function startDeviceFlow(
  verificationUriBase: string,
): Promise<DeviceFlowResult> {
  const id = nanoid();
  const deviceCode = generateToken(64);
  const userCode = generateUserCode();

  const now = new Date();
  const deviceCodeExpiresAt = new Date(
    now.getTime() + DEVICE_CODE_EXPIRY_MINUTES * 60 * 1000,
  );

  // Use a placeholder for tokenHash - will be updated when user verifies
  // This is necessary because tokenHash is NOT NULL in the schema
  const placeholderHash = hashToken(`pending-${id}`);

  await db.insert(cliTokens).values({
    id,
    tokenHash: placeholderHash,
    deviceCode: hashToken(deviceCode),
    userCode: normalizeUserCode(userCode),
    deviceCodeExpiresAt,
    status: "pending",
    createdAt: now,
  });

  return {
    deviceCode,
    userCode,
    verificationUri: `${verificationUriBase}/cli/auth`,
    verificationUriComplete: `${verificationUriBase}/cli/auth?code=${userCode}`,
    expiresIn: DEVICE_CODE_EXPIRY_MINUTES * 60,
    interval: 5, // Poll every 5 seconds
  };
}

export type TokenPollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "active"; accessToken: string; expiresAt: Date | null }
  | { status: "error"; error: string };

/**
 * Poll for token status (used by CLI to check if user has authorized)
 */
export async function pollForToken(
  deviceCode: string,
): Promise<TokenPollResult> {
  const deviceCodeHash = hashToken(deviceCode);

  const [token] = await db
    .select()
    .from(cliTokens)
    .where(eq(cliTokens.deviceCode, deviceCodeHash))
    .limit(1);

  if (!token) {
    return { status: "error", error: "Invalid device code" };
  }

  // Check if device code has expired
  if (token.deviceCodeExpiresAt && token.deviceCodeExpiresAt < new Date()) {
    // Clean up expired token
    await db.delete(cliTokens).where(eq(cliTokens.id, token.id));
    return { status: "expired" };
  }

  if (token.status === "pending") {
    return { status: "pending" };
  }

  if (token.status === "revoked") {
    return { status: "error", error: "Token has been revoked" };
  }

  // Token is active - decrypt and return the access token
  if (!token.encryptedAccessToken) {
    return { status: "error", error: "Token already retrieved" };
  }

  const accessToken = decryptToken(token.encryptedAccessToken);
  if (!accessToken) {
    return { status: "error", error: "Failed to decrypt token" };
  }

  // Clear the encrypted token after retrieval (one-time use)
  await db
    .update(cliTokens)
    .set({
      encryptedAccessToken: null,
      // Also clear device code fields since flow is complete
      deviceCode: null,
      userCode: null,
      deviceCodeExpiresAt: null,
    })
    .where(eq(cliTokens.id, token.id));

  return {
    status: "active",
    accessToken,
    expiresAt: token.expiresAt,
  };
}

export interface VerifyCodeResult {
  success: boolean;
  error?: string;
  deviceName?: string;
}

/**
 * Verify and activate a user code (called from web UI when user authorizes)
 */
export async function verifyUserCode(
  userCode: string,
  userId: string,
  deviceName?: string,
): Promise<VerifyCodeResult> {
  const normalizedCode = normalizeUserCode(userCode);

  const [token] = await db
    .select()
    .from(cliTokens)
    .where(
      and(
        eq(cliTokens.userCode, normalizedCode),
        eq(cliTokens.status, "pending"),
      ),
    )
    .limit(1);

  if (!token) {
    return { success: false, error: "Invalid or expired code" };
  }

  // Check if device code has expired
  if (token.deviceCodeExpiresAt && token.deviceCodeExpiresAt < new Date()) {
    await db.delete(cliTokens).where(eq(cliTokens.id, token.id));
    return { success: false, error: "Code has expired" };
  }

  // Generate the access token now (at verification time, not at device flow start)
  let accessToken: string;
  let tokenHash: string;
  let encryptedAccessToken: string;

  try {
    accessToken = generateToken(64);
    tokenHash = hashToken(accessToken);
    encryptedAccessToken = encryptToken(accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Token encryption failed: ${message}` };
  }

  // Calculate token expiry
  const expiresAt = new Date(
    Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  // Activate the token with the newly generated access token
  await db
    .update(cliTokens)
    .set({
      userId,
      deviceName,
      tokenHash,
      encryptedAccessToken,
      status: "active",
      expiresAt,
      // Keep deviceCode and userCode until token is retrieved by CLI
      deviceCodeExpiresAt: null,
    })
    .where(eq(cliTokens.id, token.id));

  return { success: true, deviceName };
}

/**
 * Verify an access token and return the associated user
 */
export async function verifyAccessToken(accessToken: string): Promise<{
  valid: boolean;
  userId?: string;
  tokenId?: string;
  error?: string;
}> {
  const tokenHash = hashToken(accessToken);

  const [result] = await db
    .select({
      token: cliTokens,
      user: users,
    })
    .from(cliTokens)
    .leftJoin(users, eq(cliTokens.userId, users.id))
    .where(
      and(eq(cliTokens.tokenHash, tokenHash), eq(cliTokens.status, "active")),
    )
    .limit(1);

  if (!result?.token) {
    return { valid: false, error: "Invalid token" };
  }

  const { token, user } = result;

  // Check if token has expired
  if (token.expiresAt && token.expiresAt < new Date()) {
    return { valid: false, error: "Token has expired" };
  }

  if (!token.userId || !user) {
    return { valid: false, error: "Token not associated with user" };
  }

  // Update last used timestamp
  await db
    .update(cliTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(cliTokens.id, token.id));

  return { valid: true, userId: token.userId, tokenId: token.id };
}

/**
 * Get user info from an access token
 */
export async function getUserFromToken(accessToken: string): Promise<{
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} | null> {
  const tokenHash = hashToken(accessToken);

  const [result] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      expiresAt: cliTokens.expiresAt,
    })
    .from(cliTokens)
    .innerJoin(users, eq(cliTokens.userId, users.id))
    .where(
      and(eq(cliTokens.tokenHash, tokenHash), eq(cliTokens.status, "active")),
    )
    .limit(1);

  if (!result) {
    return null;
  }

  // Check token expiry
  if (result.expiresAt && result.expiresAt < new Date()) {
    return null;
  }

  return {
    id: result.id,
    username: result.username,
    email: result.email,
    name: result.name,
    avatarUrl: result.avatarUrl,
  };
}

/**
 * Revoke a CLI token
 */
export async function revokeToken(tokenId: string): Promise<boolean> {
  const result = await db
    .update(cliTokens)
    .set({ status: "revoked" })
    .where(eq(cliTokens.id, tokenId))
    .returning({ id: cliTokens.id });

  return result.length > 0;
}

/**
 * Rename a CLI token's device name
 */
export async function renameToken(
  tokenId: string,
  deviceName: string,
): Promise<boolean> {
  const result = await db
    .update(cliTokens)
    .set({ deviceName })
    .where(eq(cliTokens.id, tokenId))
    .returning({ id: cliTokens.id });

  return result.length > 0;
}

/**
 * Revoke all CLI tokens for a user
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await db
    .update(cliTokens)
    .set({ status: "revoked" })
    .where(and(eq(cliTokens.userId, userId), eq(cliTokens.status, "active")))
    .returning({ id: cliTokens.id });

  return result.length;
}

/**
 * Get all active tokens for a user
 */
export async function getUserTokens(userId: string): Promise<
  Array<{
    id: string;
    deviceName: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    expiresAt: Date | null;
  }>
> {
  return db
    .select({
      id: cliTokens.id,
      deviceName: cliTokens.deviceName,
      lastUsedAt: cliTokens.lastUsedAt,
      createdAt: cliTokens.createdAt,
      expiresAt: cliTokens.expiresAt,
    })
    .from(cliTokens)
    .where(and(eq(cliTokens.userId, userId), eq(cliTokens.status, "active")));
}

/**
 * Clean up expired pending tokens (called periodically or on startup)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await db
    .delete(cliTokens)
    .where(
      and(
        eq(cliTokens.status, "pending"),
        lt(cliTokens.deviceCodeExpiresAt, new Date()),
      ),
    )
    .returning({ id: cliTokens.id });

  return result.length;
}
