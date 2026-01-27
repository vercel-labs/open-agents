import { db } from "./client";
import {
  linkedAccounts,
  type LinkedAccount,
  type NewLinkedAccount,
} from "./schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function createLinkedAccount(
  data: Omit<NewLinkedAccount, "id" | "createdAt" | "updatedAt">,
): Promise<LinkedAccount> {
  const id = nanoid();
  const now = new Date();

  const [account] = await db
    .insert(linkedAccounts)
    .values({
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!account) {
    throw new Error("Failed to create linked account");
  }

  return account;
}

export async function getLinkedAccountById(
  id: string,
): Promise<LinkedAccount | undefined> {
  const [account] = await db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.id, id))
    .limit(1);

  return account;
}

export async function getLinkedAccountsByUserId(
  userId: string,
): Promise<LinkedAccount[]> {
  return db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.userId, userId));
}

export async function getLinkedAccountByProviderAndExternalId(
  provider: LinkedAccount["provider"],
  externalId: string,
  workspaceId?: string,
): Promise<LinkedAccount | undefined> {
  const conditions = [
    eq(linkedAccounts.provider, provider),
    eq(linkedAccounts.externalId, externalId),
  ];

  if (workspaceId !== undefined) {
    conditions.push(eq(linkedAccounts.workspaceId, workspaceId));
  }

  const [account] = await db
    .select()
    .from(linkedAccounts)
    .where(and(...conditions))
    .limit(1);

  return account;
}

export async function updateLinkedAccount(
  id: string,
  data: Partial<Pick<LinkedAccount, "metadata">>,
): Promise<LinkedAccount | undefined> {
  const [account] = await db
    .update(linkedAccounts)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(linkedAccounts.id, id))
    .returning();

  return account;
}

export async function deleteLinkedAccount(id: string): Promise<boolean> {
  const result = await db
    .delete(linkedAccounts)
    .where(eq(linkedAccounts.id, id))
    .returning({ id: linkedAccounts.id });

  return result.length > 0;
}

export async function deleteLinkedAccountsByUserId(
  userId: string,
): Promise<number> {
  const result = await db
    .delete(linkedAccounts)
    .where(eq(linkedAccounts.userId, userId))
    .returning({ id: linkedAccounts.id });

  return result.length;
}
