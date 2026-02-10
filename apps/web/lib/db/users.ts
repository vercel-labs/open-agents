import { db } from "./client";
import { users } from "./schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function upsertUser(userData: {
  provider: "github" | "vercel";
  externalId: string;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  username: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  tokenExpiresAt?: Date;
}): Promise<string> {
  const {
    provider,
    externalId,
    accessToken,
    refreshToken,
    scope,
    tokenExpiresAt,
  } = userData;

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.provider, provider), eq(users.externalId, externalId)))
    .limit(1);

  if (existingUser.length > 0 && existingUser[0]) {
    await db
      .update(users)
      .set({
        accessToken,
        refreshToken,
        scope,
        tokenExpiresAt,
        username: userData.username,
        email: userData.email,
        name: userData.name,
        avatarUrl: userData.avatarUrl,
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, existingUser[0].id));
    return existingUser[0].id;
  }

  const userId = nanoid();
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    ...userData,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
  return userId;
}
