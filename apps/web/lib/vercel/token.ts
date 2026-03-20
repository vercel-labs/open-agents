import "server-only";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { refreshVercelToken } from "./oauth";

interface UserVercelAuthRow {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  externalId: string;
}

export interface UserVercelAuthInfo {
  token: string;
  expiresAt: number;
  externalId: string;
}

async function loadUserVercelAuthRow(
  userId: string,
): Promise<UserVercelAuthRow | null> {
  const result = await db
    .select({
      accessToken: users.accessToken,
      refreshToken: users.refreshToken,
      tokenExpiresAt: users.tokenExpiresAt,
      externalId: users.externalId,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.provider, "vercel")))
    .limit(1);

  return result[0] ?? null;
}

function toAuthInfo(params: {
  token: string;
  tokenExpiresAt: Date;
  externalId: string;
}): UserVercelAuthInfo {
  return {
    token: params.token,
    expiresAt: Math.floor(params.tokenExpiresAt.getTime() / 1000),
    externalId: params.externalId,
  };
}

async function refreshUserVercelAuthInfo(
  userId: string,
  row: UserVercelAuthRow,
): Promise<UserVercelAuthInfo | null> {
  if (!row.refreshToken) {
    return null;
  }

  const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
  const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  const decryptedRefresh = decrypt(row.refreshToken);
  const tokens = await refreshVercelToken({
    refreshToken: decryptedRefresh,
    clientId,
    clientSecret,
  });

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db
    .update(users)
    .set({
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : row.refreshToken,
      tokenExpiresAt: newExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return toAuthInfo({
    token: tokens.access_token,
    tokenExpiresAt: newExpiresAt,
    externalId: row.externalId,
  });
}

/**
 * Get a valid Vercel access token plus CLI-relevant metadata for the given user.
 * If the token is expired, or its expiry is unknown, refreshes inline when possible.
 */
export async function getUserVercelAuthInfo(
  userId: string,
): Promise<UserVercelAuthInfo | null> {
  try {
    const row = await loadUserVercelAuthRow(userId);
    if (!row?.accessToken) {
      return null;
    }

    const now = Date.now();
    const tokenExpiresAtMs = row.tokenExpiresAt?.getTime() ?? null;
    const isExpired = tokenExpiresAtMs !== null && tokenExpiresAtMs < now;

    if (!isExpired && row.tokenExpiresAt) {
      return toAuthInfo({
        token: decrypt(row.accessToken),
        tokenExpiresAt: row.tokenExpiresAt,
        externalId: row.externalId,
      });
    }

    return refreshUserVercelAuthInfo(userId, row);
  } catch (error) {
    console.error("Error fetching Vercel auth:", error);
    return null;
  }
}

/**
 * Get a valid Vercel access token for the given user.
 * If the token is expired and a refresh token exists, refreshes inline and updates the DB.
 */
export async function getUserVercelToken(
  userId: string,
): Promise<string | null> {
  const authInfo = await getUserVercelAuthInfo(userId);
  if (authInfo) {
    return authInfo.token;
  }

  try {
    const row = await loadUserVercelAuthRow(userId);
    if (!row?.accessToken || row.tokenExpiresAt) {
      return null;
    }

    return decrypt(row.accessToken);
  } catch (error) {
    console.error("Error fetching Vercel token:", error);
    return null;
  }
}
