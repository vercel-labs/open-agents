import { describe, expect, test } from "bun:test";
import type { UserPreferencesData } from "@/lib/db/user-preferences";
import type { ModelVariant } from "@/lib/model-variants";
import {
  filterModelsForSession,
  filterModelVariantsForSession,
  sanitizeSelectedModelIdForSession,
  sanitizeUserPreferencesForSession,
} from "./model-access";

const hostedSession = {
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

describe("model access helpers", () => {
  test("leaves base models unchanged for hosted users", () => {
    const result = filterModelsForSession(
      [
        { id: "anthropic/claude-opus-4.6" },
        { id: "anthropic/claude-haiku-4.5" },
      ],
      hostedSession,
      requestUrl,
    );

    expect(result).toEqual([
      { id: "anthropic/claude-opus-4.6" },
      { id: "anthropic/claude-haiku-4.5" },
    ]);
  });

  test("leaves model variants unchanged for hosted users", () => {
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
      hostedSession,
      requestUrl,
    );

    expect(result.map((variant) => variant.id)).toEqual([
      "variant:user-opus",
      "variant:user-gpt",
    ]);
  });

  test("keeps selected models unchanged for hosted users", () => {
    const result = sanitizeSelectedModelIdForSession(
      "variant:builtin:claude-opus-4.6-high",
      [userOpusVariant],
      hostedSession,
      requestUrl,
    );

    expect(result).toBe("variant:builtin:claude-opus-4.6-high");
  });

  test("returns preferences unchanged for hosted users", () => {
    const result = sanitizeUserPreferencesForSession(
      basePreferences,
      hostedSession,
      requestUrl,
    );

    expect(result).toEqual(basePreferences);
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
