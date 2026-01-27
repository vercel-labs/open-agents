import { db } from "./client";
import { userPreferences } from "./schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { SandboxType } from "@/components/sandbox-selector-compact";

export interface UserPreferencesData {
  defaultModelId: string;
  defaultSandboxType: SandboxType;
}

const DEFAULT_PREFERENCES: UserPreferencesData = {
  defaultModelId: "anthropic/claude-haiku-4.5",
  defaultSandboxType: "hybrid",
};

/**
 * Get user preferences, creating default preferences if none exist
 */
export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesData> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing) {
    return {
      defaultModelId:
        existing.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
      defaultSandboxType:
        (existing.defaultSandboxType as SandboxType) ??
        DEFAULT_PREFERENCES.defaultSandboxType,
    };
  }

  return DEFAULT_PREFERENCES;
}

/**
 * Update user preferences, creating if they don't exist
 */
export async function updateUserPreferences(
  userId: string,
  updates: Partial<UserPreferencesData>,
): Promise<UserPreferencesData> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(userPreferences)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.userId, userId))
      .returning();

    return {
      defaultModelId:
        updated?.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
      defaultSandboxType:
        (updated?.defaultSandboxType as SandboxType) ??
        DEFAULT_PREFERENCES.defaultSandboxType,
    };
  }

  // Create new preferences
  const [created] = await db
    .insert(userPreferences)
    .values({
      id: nanoid(),
      userId,
      defaultModelId:
        updates.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
      defaultSandboxType:
        updates.defaultSandboxType ?? DEFAULT_PREFERENCES.defaultSandboxType,
    })
    .returning();

  return {
    defaultModelId:
      created?.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
    defaultSandboxType:
      (created?.defaultSandboxType as SandboxType) ??
      DEFAULT_PREFERENCES.defaultSandboxType,
  };
}
