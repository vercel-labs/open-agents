import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";

/**
 * Get a valid GitHub access token for the given user.
 * better-auth auto-refreshes expired tokens via stored refresh token.
 */
export async function getUserGitHubToken(
  userId: string,
): Promise<string | null> {
  try {
    const result = await auth.api.getAccessToken({
      body: { providerId: "github", userId },
    });

    return result?.accessToken ?? null;
  } catch (error) {
    // "Account not found" is expected when the user hasn't linked GitHub —
    // only log unexpected errors.
    const isExpected =
      error instanceof Error && error.message === "Account not found";
    if (!isExpected) {
      console.error("Error fetching GitHub token:", error);
    }
    return null;
  }
}

/**
 * Check whether the user has a linked GitHub account in better-auth.
 */
export async function hasGitHubAccount(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")))
    .limit(1);
  return rows.length > 0;
}

/**
 * Get the GitHub username for the given user by calling the GitHub API.
 * Falls back to githubInstallations.accountLogin for the personal account
 * if available, but this function always makes a fresh API call.
 */
export async function getGitHubUsername(
  userId: string,
): Promise<string | null> {
  const token = await getUserGitHubToken(userId);
  if (!token) return null;

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { login?: string };
    return user.login ?? null;
  } catch {
    return null;
  }
}

export interface GitHubUserProfile {
  username: string;
  externalUserId: string;
}

/**
 * Get the GitHub user profile (username + numeric ID) for the given user.
 * Used for git author identity and noreply email construction.
 */
export async function getGitHubUserProfile(
  userId: string,
): Promise<GitHubUserProfile | null> {
  const token = await getUserGitHubToken(userId);
  if (!token) return null;

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: number; login?: string };
    if (!user.login || !user.id) return null;
    return { username: user.login, externalUserId: `${user.id}` };
  } catch {
    return null;
  }
}

/**
 * Delete the GitHub account link from better-auth's accounts table.
 */
export async function deleteGitHubAccountLink(userId: string): Promise<void> {
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")));
}
