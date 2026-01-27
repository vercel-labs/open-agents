import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";

/**
 * Credentials stored locally for CLI authentication
 */
export interface Credentials {
  token: string;
  userId: string;
  username: string;
  expiresAt: string | null;
}

// Path to credentials file
const CONFIG_DIR = join(homedir(), ".config", "open-harness");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

/**
 * Ensure the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
  } catch (error) {
    // Directory may already exist
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Load credentials from the local file
 * Returns undefined if no credentials are stored or file is invalid
 */
export async function loadCredentials(): Promise<Credentials | undefined> {
  try {
    const content = await readFile(CREDENTIALS_FILE, "utf-8");
    const credentials = JSON.parse(content) as Credentials;

    // Basic validation
    if (!credentials.token || !credentials.userId || !credentials.username) {
      return undefined;
    }

    // Check if token has expired
    if (credentials.expiresAt) {
      const expiresAt = new Date(credentials.expiresAt);
      if (expiresAt < new Date()) {
        // Token expired, clear it
        await clearCredentials();
        return undefined;
      }
    }

    return credentials;
  } catch {
    // File doesn't exist or is invalid
    return undefined;
  }
}

/**
 * Save credentials to the local file
 */
export async function saveCredentials(credentials: Credentials): Promise<void> {
  await ensureConfigDir();
  await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    mode: 0o600, // Read/write for owner only
  });
}

/**
 * Clear stored credentials
 */
export async function clearCredentials(): Promise<void> {
  try {
    await unlink(CREDENTIALS_FILE);
  } catch {
    // File may not exist, that's fine
  }
}

/**
 * Check if credentials exist and are valid
 */
export async function hasValidCredentials(): Promise<boolean> {
  const credentials = await loadCredentials();
  return credentials !== undefined;
}

/**
 * Get the credentials file path (for display purposes)
 */
export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string; isNetworkError: false }
  | { valid: false; error: string; isNetworkError: true };

/**
 * Validate credentials against the server
 * Returns true if the token is valid, false if revoked/expired
 */
export async function validateCredentials(
  credentials: Credentials,
  apiBaseUrl: string,
): Promise<ValidationResult> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/cli/auth/me`, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    if (response.status === 401) {
      // Token is invalid or revoked - clear local credentials
      await clearCredentials();
      return {
        valid: false,
        error: "Token has been revoked or expired",
        isNetworkError: false,
      };
    }

    // Other HTTP errors (5xx, etc.) - don't clear credentials
    return {
      valid: false,
      error: `Server returned ${response.status}`,
      isNetworkError: true,
    };
  } catch (error) {
    // Network error - don't clear credentials, might be temporary
    const message = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      error: `Failed to connect: ${message}`,
      isNetworkError: true,
    };
  }
}
