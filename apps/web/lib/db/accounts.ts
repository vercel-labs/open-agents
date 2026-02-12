import { db } from "./client";
import { accounts } from "./schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function upsertGitHubAccount(data: {
  userId: string;
  externalUserId: string;
  accessToken: string;
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
    scope: data.scope,
    username: data.username,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getGitHubAccount(userId: string): Promise<{
  accessToken: string;
  username: string;
  externalUserId: string;
} | null> {
  const result = await db
    .select({
      accessToken: accounts.accessToken,
      username: accounts.username,
      externalUserId: accounts.externalUserId,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")))
    .limit(1);

  return result[0] ?? null;
}

export async function deleteGitHubAccount(userId: string): Promise<void> {
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")));
}
