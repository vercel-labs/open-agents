import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { accounts } from "./schema";

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
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.userId, data.userId), eq(accounts.provider, "github")),
    )
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    await db
      .update(accounts)
      .set({
        externalUserId: data.externalUserId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        expiresAt: data.expiresAt ?? null,
        scope: data.scope,
        username: data.username,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, existing[0].id));
    return existing[0].id;
  }

  const id = nanoid();
  const now = new Date();
  await db.insert(accounts).values({
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
      accessToken: accounts.accessToken,
      refreshToken: accounts.refreshToken,
      expiresAt: accounts.expiresAt,
      username: accounts.username,
      externalUserId: accounts.externalUserId,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")))
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
    .update(accounts)
    .set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? null,
      expiresAt: data.expiresAt ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")));
}

export async function deleteGitHubAccount(userId: string): Promise<void> {
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")));
}
