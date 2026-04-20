import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { githubAccounts } from "./schema";

export async function upsertGitHubAccount(data: {
  userId: string;
  externalUserId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  username: string;
}): Promise<string> {
  const existing = await db
    .select({ id: githubAccounts.id })
    .from(githubAccounts)
    .where(
      and(eq(githubAccounts.userId, data.userId), eq(githubAccounts.provider, "github")),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    await db
      .update(githubAccounts)
      .set({
        externalUserId: data.externalUserId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        expiresAt: data.expiresAt ?? null,
        scope: data.scope,
        username: data.username,
        updatedAt: new Date(),
      })
      .where(eq(githubAccounts.id, existing[0].id));
    return existing[0].id;
  }

  const id = nanoid();
  const now = new Date();
  await db.insert(githubAccounts).values({
    id,
    userId: data.userId,
    provider: "github",
    externalUserId: data.externalUserId,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    scope: data.scope,
    username: data.username,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getGitHubAccount(userId: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  username: string;
  externalUserId: string;
} | null> {
  const result = await db
    .select({
      accessToken: githubAccounts.accessToken,
      refreshToken: githubAccounts.refreshToken,
      expiresAt: githubAccounts.expiresAt,
      username: githubAccounts.username,
      externalUserId: githubAccounts.externalUserId,
    })
    .from(githubAccounts)
    .where(and(eq(githubAccounts.userId, userId), eq(githubAccounts.provider, "github")))
    .limit(1);

  return result[0] ?? null;
}

export async function updateGitHubAccountTokens(
  userId: string,
  data: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  },
): Promise<void> {
  await db
    .update(githubAccounts)
    .set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? null,
      expiresAt: data.expiresAt ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(githubAccounts.userId, userId), eq(githubAccounts.provider, "github")));
}

export async function deleteGitHubAccount(userId: string): Promise<void> {
  await db
    .delete(githubAccounts)
    .where(and(eq(githubAccounts.userId, userId), eq(githubAccounts.provider, "github")));
}
