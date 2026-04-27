import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { getUserGitHubToken } from "./token";

export interface GitHubUserProfile {
  username: string;
  externalUserId: string;
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
 * Get the GitHub numeric account ID stored in better-auth's accounts table.
 * Available even when the token is revoked.
 */
export async function getGitHubAccountId(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ accountId: accounts.accountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")))
    .limit(1);
  return row?.accountId ?? null;
}

/**
 * Delete the GitHub account link from better-auth's accounts table.
 */
export async function deleteGitHubAccountLink(userId: string): Promise<void> {
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")));
}

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

interface GitHubOrg {
  login: string;
  avatar_url: string;
}

/**
 * Fetch the authenticated GitHub user's profile.
 */
export async function fetchGitHubUser(token: string) {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) return null;

    const user = (await response.json()) as GitHubUser;
    return {
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the authenticated GitHub user's organizations.
 */
export async function fetchGitHubOrgs(token: string) {
  try {
    const response = await fetch(
      "https://api.github.com/user/orgs?per_page=100",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!response.ok) return null;

    const orgs = (await response.json()) as GitHubOrg[];
    return orgs.map((org) => ({
      login: org.login,
      name: org.login,
      avatar_url: org.avatar_url,
    }));
  } catch {
    return null;
  }
}
