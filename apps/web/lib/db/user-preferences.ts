import type { SandboxType } from "@/components/sandbox-selector-compact";
import { parseModelVariants, type ModelVariant } from "@/lib/model-variants";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { userPreferences } from "./schema";

export interface UserPreferencesData {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  modelVariants: ModelVariant[];
  defaultSandboxType: SandboxType;
}

const DEFAULT_PREFERENCES: UserPreferencesData = {
  defaultModelId: "anthropic/claude-haiku-4.5",
  defaultSubagentModelId: null,
  modelVariants: [],
  defaultSandboxType: "vercel",
};

function toUserPreferencesData(
  preferences: typeof userPreferences.$inferSelect | undefined,
): UserPreferencesData {
  return {
    defaultModelId:
      preferences?.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
    defaultSubagentModelId: preferences?.defaultSubagentModelId ?? null,
    modelVariants: parseModelVariants(preferences?.modelVariants),
    defaultSandboxType:
      (preferences?.defaultSandboxType as SandboxType) ??
      DEFAULT_PREFERENCES.defaultSandboxType,
  };
}

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
    return toUserPreferencesData(existing);
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

    return toUserPreferencesData(updated);
  }

  // Create new preferences
  const [created] = await db
    .insert(userPreferences)
    .values({
      id: nanoid(),
      userId,
      defaultModelId:
        updates.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
      defaultSubagentModelId: updates.defaultSubagentModelId ?? null,
      modelVariants: updates.modelVariants ?? DEFAULT_PREFERENCES.modelVariants,
      defaultSandboxType:
        updates.defaultSandboxType ?? DEFAULT_PREFERENCES.defaultSandboxType,
    })
    .returning();

  return toUserPreferencesData(created);
}
