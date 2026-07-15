import "server-only";
import {
  deleteTokenCacheEntry,
  getToken,
  NoValidTokenError,
  revokeToken,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import {
  getGitHubConnector,
  isGitHubConnectorConfigured,
} from "@/lib/github/connector";

/**
 * Look up the Vercel Connect subject id for the user's linked GitHub
 * account. better-auth stores the Connect OIDC `sub` as
 * `accounts.accountId` during the generic OAuth link flow. Queried directly
 * here (not via `lib/github/users.ts`, which imports this module).
 */
async function getGitHubSubjectId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: accounts.accountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")))
    .limit(1);
  return row?.accountId ?? null;
}

function userSubjectParams(accountId: string) {
  return { subject: { type: "user" as const, id: accountId } };
}

/**
 * Get a valid GitHub access token for the given user. Tokens are exchanged
 * at request time via the Vercel Connect connector (cached and refreshed by
 * the SDK). `null` means the user needs to (re)connect GitHub.
 */
export async function getUserGitHubToken(
  userId: string,
): Promise<string | null> {
  if (!isGitHubConnectorConfigured()) {
    return null;
  }

  const accountId = await getGitHubSubjectId(userId);
  if (!accountId) {
    return null;
  }

  try {
    return await getToken(getGitHubConnector(), userSubjectParams(accountId));
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof NoValidTokenError
    ) {
      // Grant missing or revoked — consumers treat null as "reconnect
      // required".
      return null;
    }
    console.error("Error fetching GitHub token:", error);
    return null;
  }
}

export async function getGitHubAppUserToken(
  userId: string,
): Promise<string | null> {
  return getUserGitHubToken(userId);
}

/**
 * Revoke the user's GitHub grant in Vercel Connect (and drop the locally
 * cached token) so disconnecting actually invalidates access rather than
 * only deleting the local account row.
 */
export async function revokeUserGitHubGrant(userId: string): Promise<boolean> {
  if (!isGitHubConnectorConfigured()) {
    return false;
  }

  const accountId = await getGitHubSubjectId(userId);
  if (!accountId) {
    return false;
  }

  try {
    await revokeToken(getGitHubConnector(), userSubjectParams(accountId));
    deleteTokenCacheEntry(getGitHubConnector(), userSubjectParams(accountId));
    return true;
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof NoValidTokenError
    ) {
      // Nothing to revoke.
      return true;
    }
    console.error("Failed to revoke GitHub grant:", error);
    return false;
  }
}
