import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { modelVariantsSchema, type ModelVariant } from "@/lib/model-variants";
import {
  normalizeGlobalSkillRefs,
  type GlobalSkillRef,
} from "@/lib/skills/global-skill-refs";
import { db } from "./client";
import { userPreferences, type UserPreferences } from "./schema";

export type DiffMode = "unified" | "split";

export interface UserPreferencesData {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  defaultSandboxType: SandboxType;
  defaultDiffMode: DiffMode;
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  globalSkillRefs: GlobalSkillRef[];
  modelVariants: ModelVariant[];
  enabledModelIds: string[];
}

const DEFAULT_PREFERENCES: UserPreferencesData = {
  defaultModelId: "anthropic/claude-opus-4.6",
  defaultSubagentModelId: null,
  defaultSandboxType: "vercel",
  defaultDiffMode: "unified",
  autoCommitPush: false,
  autoCreatePr: false,
  globalSkillRefs: [],
  modelVariants: [],
  enabledModelIds: [],
};

const VALID_SANDBOX_TYPES: SandboxType[] = ["vercel"];
const VALID_DIFF_MODES: DiffMode[] = ["unified", "split"];

function normalizeSandboxType(value: unknown): SandboxType {
  if (value === "hybrid") {
    return "vercel";
  }

  if (
    typeof value === "string" &&
    VALID_SANDBOX_TYPES.includes(value as SandboxType)
  ) {
    return value as SandboxType;
  }

  return DEFAULT_PREFERENCES.defaultSandboxType;
}

function normalizeDiffMode(value: unknown): DiffMode {
  if (
    typeof value === "string" &&
    VALID_DIFF_MODES.includes(value as DiffMode)
  ) {
    return value as DiffMode;
  }

  return DEFAULT_PREFERENCES.defaultDiffMode;
}

function normalizeEnabledModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function toUserPreferencesData(
  row?: Pick<
    UserPreferences,
    | "defaultModelId"
    | "defaultSubagentModelId"
    | "defaultSandboxType"
    | "defaultDiffMode"
    | "autoCommitPush"
    | "autoCreatePr"
    | "globalSkillRefs"
    | "modelVariants"
    | "enabledModelIds"
  >,
): UserPreferencesData {
  const parsedModelVariants = modelVariantsSchema.safeParse(
    row?.modelVariants ?? [],
  );

  return {
    defaultModelId: row?.defaultModelId ?? DEFAULT_PREFERENCES.defaultModelId,
    defaultSubagentModelId: row?.defaultSubagentModelId ?? null,
    defaultSandboxType: normalizeSandboxType(row?.defaultSandboxType),
    defaultDiffMode: normalizeDiffMode(row?.defaultDiffMode),
    autoCommitPush: row?.autoCommitPush ?? DEFAULT_PREFERENCES.autoCommitPush,
    autoCreatePr: row?.autoCreatePr ?? DEFAULT_PREFERENCES.autoCreatePr,
    globalSkillRefs: normalizeGlobalSkillRefs(row?.globalSkillRefs),
    modelVariants: parsedModelVariants.success ? parsedModelVariants.data : [],
    enabledModelIds: normalizeEnabledModelIds(row?.enabledModelIds),
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

  return toUserPreferencesData(existing);
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
      defaultSandboxType:
        updates.defaultSandboxType ?? DEFAULT_PREFERENCES.defaultSandboxType,
      defaultDiffMode:
        updates.defaultDiffMode ?? DEFAULT_PREFERENCES.defaultDiffMode,
      autoCommitPush:
        updates.autoCommitPush ?? DEFAULT_PREFERENCES.autoCommitPush,
      autoCreatePr: updates.autoCreatePr ?? DEFAULT_PREFERENCES.autoCreatePr,
      globalSkillRefs:
        updates.globalSkillRefs ?? DEFAULT_PREFERENCES.globalSkillRefs,
      modelVariants: updates.modelVariants ?? DEFAULT_PREFERENCES.modelVariants,
      enabledModelIds:
        updates.enabledModelIds ?? DEFAULT_PREFERENCES.enabledModelIds,
    })
    .returning();

  return toUserPreferencesData(created);
}
