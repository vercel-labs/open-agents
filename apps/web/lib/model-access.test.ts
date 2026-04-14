import { describe, expect, test } from "bun:test";
import type { UserPreferencesData } from "@/lib/db/user-preferences";
import type { ModelVariant } from "@/lib/model-variants";
import {
  filterModelsForSession,
  filterModelVariantsForSession,
  sanitizeSelectedModelIdForSession,
  sanitizeUserPreferencesForSession,
} from "./model-access";

const managedTrialSession = {
  authProvider: "vercel" as const,
  user: {
    id: "user-1",
    username: "alice",
    email: "alice@example.com",
    avatar: "",
  },
};

const vercelSession = {
  authProvider: "vercel" as const,
  user: {
    id: "user-2",
    username: "vercel-user",
    email: "dev@vercel.com",
    avatar: "",
  },
};

const requestUrl = "https://open-agents.dev/api/test";

const userOpusVariant: ModelVariant = {
  id: "variant:user-opus",
  name: "User Opus",
  baseModelId: "anthropic/claude-opus-4.6",
  providerOptions: { effort: "high" },
};

const basePreferences: UserPreferencesData = {
  defaultModelId: "anthropic/claude-opus-4.6",
  defaultSubagentModelId: "variant:builtin:claude-opus-4.6-high",
  defaultSandboxType: "vercel",
  defaultDiffMode: "unified",
  autoCommitPush: false,
  autoCreatePr: false,
  alertsEnabled: true,
  alertSoundEnabled: true,
  publicUsageEnabled: false,
  globalSkillRefs: [],
  modelVariants: [userOpusVariant],
  enabledModelIds: ["anthropic/claude-opus-4.6", "openai/gpt-5"],
};

describe("model access gating", () => {
  test("filters Claude Opus base models for managed trial users", () => {
    const result = filterModelsForSession(
      [
        { id: "anthropic/claude-opus-4.6" },
        { id: "anthropic/claude-haiku-4.5" },
      ],
      managedTrialSession,
      requestUrl,
    );

    expect(result).toEqual([{ id: "anthropic/claude-haiku-4.5" }]);
  });

  test("filters Opus-backed variants for managed trial users", () => {
    const result = filterModelVariantsForSession(
      [
        userOpusVariant,
        {
          id: "variant:user-gpt",
          name: "User GPT",
          baseModelId: "openai/gpt-5",
          providerOptions: {},
        },
      ],
      managedTrialSession,
      requestUrl,
    );

    expect(result.map((variant) => variant.id)).toEqual(["variant:user-gpt"]);
  });

  test("falls back to the app default when a managed trial user selects an Opus variant", () => {
    const result = sanitizeSelectedModelIdForSession(
      "variant:builtin:claude-opus-4.6-high",
      [userOpusVariant],
      managedTrialSession,
      requestUrl,
    );

    expect(result).toBe("openai/gpt-5.4");
  });

  test("sanitizes managed trial preferences without mutating the database shape", () => {
    const result = sanitizeUserPreferencesForSession(
      basePreferences,
      managedTrialSession,
      requestUrl,
    );

    expect(result).toMatchObject({
      defaultModelId: "openai/gpt-5.4",
      defaultSubagentModelId: "openai/gpt-5.4",
      modelVariants: [],
      enabledModelIds: ["openai/gpt-5"],
    });
  });

  test("leaves Vercel users unchanged", () => {
    const result = sanitizeUserPreferencesForSession(
      basePreferences,
      vercelSession,
      requestUrl,
    );

    expect(result).toEqual(basePreferences);
  });
});
