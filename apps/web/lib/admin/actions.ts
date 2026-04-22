"use server";

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { accounts, authSessions, githubInstallations } from "@/lib/db/schema";
import { isUserAdmin } from "@/lib/db/users";
import { getServerSession } from "@/lib/session/get-server-session";

async function requireAdmin(): Promise<string> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }
  const admin = await isUserAdmin(session.user.id);
  if (!admin) {
    throw new Error("Forbidden");
  }
  return session.user.id;
}

// ---------------------------------------------------------------------------
// GitHub revocation helpers
// ---------------------------------------------------------------------------

/**
 * Revoke a single GitHub OAuth token via the GitHub Applications API.
 * Uses HTTP Basic auth with clientId:clientSecret.
 */
async function revokeGitHubToken(token: string): Promise<boolean> {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  try {
    const res = await fetch(
      `https://api.github.com/applications/${clientId}/token`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ access_token: token }),
      },
    );
    // 204 = success, 422 = token already invalid — both are fine
    return res.status === 204 || res.status === 422;
  } catch (err) {
    console.error("GitHub token revocation failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Vercel revocation helpers
// ---------------------------------------------------------------------------

const VERCEL_REVOKE_URL = "https://api.vercel.com/login/oauth/token/revoke";

/**
 * Revoke a single Vercel OAuth token via the Vercel revocation endpoint.
 */
async function revokeVercelToken(token: string): Promise<boolean> {
  const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
  const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  try {
    await fetch(VERCEL_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    return true;
  } catch (err) {
    console.error("Vercel token revocation failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bulk admin actions
// ---------------------------------------------------------------------------

/**
 * Revoke all GitHub tokens at the provider, then delete account links
 * and installations from the DB.
 *
 * Flow: decrypt each token via better-auth → revoke at GitHub API → delete DB rows.
 * Failures to revoke individual tokens are logged but don't block the operation;
 * we still delete the DB rows so the app no longer considers them connected.
 */
export async function revokeAllGitHubTokens(): Promise<{
  success: boolean;
  error?: string;
  revokedTokens?: number;
  deletedAccounts?: number;
  deletedInstallations?: number;
}> {
  try {
    await requireAdmin();

    // 1. Get all GitHub account rows to find unique user IDs
    const githubAccounts = await db
      .select({ id: accounts.id, userId: accounts.userId })
      .from(accounts)
      .where(eq(accounts.providerId, "github"));

    // 2. Decrypt + revoke each token at GitHub
    let revokedTokens = 0;
    const revokeResults = await Promise.allSettled(
      githubAccounts.map(async (acct) => {
        try {
          const result = await auth.api.getAccessToken({
            body: { providerId: "github", userId: acct.userId },
          });
          if (result?.accessToken) {
            const ok = await revokeGitHubToken(result.accessToken);
            if (ok) revokedTokens++;
          }
        } catch {
          // Token may already be expired/invalid — that's fine
        }
      }),
    );

    const failedRevocations = revokeResults.filter(
      (r) => r.status === "rejected",
    ).length;
    if (failedRevocations > 0) {
      console.warn(
        `${failedRevocations}/${githubAccounts.length} GitHub token revocations failed at the provider`,
      );
    }

    // 3. Delete all GitHub account links and installations from DB
    const [accountResult, installResult] = await Promise.all([
      db
        .delete(accounts)
        .where(eq(accounts.providerId, "github"))
        .returning({ id: accounts.id }),
      db.delete(githubInstallations).returning({ id: githubInstallations.id }),
    ]);

    return {
      success: true,
      revokedTokens,
      deletedAccounts: accountResult.length,
      deletedInstallations: installResult.length,
    };
  } catch (error) {
    console.error("Failed to revoke all GitHub tokens:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to revoke tokens",
    };
  }
}

/**
 * Revoke all Vercel tokens at the provider, then delete account links
 * and auth sessions from the DB.
 *
 * Flow: decrypt each token via better-auth → revoke at Vercel API → delete DB rows.
 * This will log out ALL users (including the admin) since auth sessions are cleared.
 */
export async function revokeAllVercelTokens(): Promise<{
  success: boolean;
  error?: string;
  revokedTokens?: number;
  deletedAccounts?: number;
  deletedSessions?: number;
}> {
  try {
    await requireAdmin();

    // 1. Get all Vercel account rows to find unique user IDs
    const vercelAccounts = await db
      .select({ id: accounts.id, userId: accounts.userId })
      .from(accounts)
      .where(eq(accounts.providerId, "vercel"));

    // 2. Decrypt + revoke each token at Vercel
    let revokedTokens = 0;
    const revokeResults = await Promise.allSettled(
      vercelAccounts.map(async (acct) => {
        try {
          const result = await auth.api.getAccessToken({
            body: { providerId: "vercel", userId: acct.userId },
          });
          if (result?.accessToken) {
            const ok = await revokeVercelToken(result.accessToken);
            if (ok) revokedTokens++;
          }
        } catch {
          // Token may already be expired/invalid — that's fine
        }
      }),
    );

    const failedRevocations = revokeResults.filter(
      (r) => r.status === "rejected",
    ).length;
    if (failedRevocations > 0) {
      console.warn(
        `${failedRevocations}/${vercelAccounts.length} Vercel token revocations failed at the provider`,
      );
    }

    // 3. Delete all Vercel account links and auth sessions from DB
    const [accountResult, sessionResult] = await Promise.all([
      db
        .delete(accounts)
        .where(eq(accounts.providerId, "vercel"))
        .returning({ id: accounts.id }),
      db.delete(authSessions).returning({ id: authSessions.id }),
    ]);

    return {
      success: true,
      revokedTokens,
      deletedAccounts: accountResult.length,
      deletedSessions: sessionResult.length,
    };
  } catch (error) {
    console.error("Failed to revoke all Vercel tokens:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to revoke tokens",
    };
  }
}
