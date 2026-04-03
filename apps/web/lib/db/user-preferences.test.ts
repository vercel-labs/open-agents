import { describe, expect, mock, test } from "bun:test";

mock.module("./client", () => ({
  db: {},
}));

const userPreferencesModulePromise = import("./user-preferences");

describe("toUserPreferencesData", () => {
  test("returns defaults when row is undefined", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    expect(toUserPreferencesData()).toEqual({
      defaultModelId: "anthropic/claude-opus-4.6",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    });
  });

  test("normalizes invalid sandbox and diff mode values to defaults", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: "openai/gpt-5-mini",
      defaultSandboxType: "invalid" as never,
      defaultDiffMode: "invalid" as never,
      autoCommitPush: false,
      autoCreatePr: false,
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.defaultSandboxType).toBe("vercel");
    expect(result.defaultDiffMode).toBe("unified");
  });

  test("normalizes legacy hybrid sandbox types to vercel", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "hybrid" as never,
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.defaultSandboxType).toBe("vercel");
    expect(result.defaultDiffMode).toBe("unified");
  });

  test("drops invalid globalSkillRefs payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      globalSkillRefs: [
        { source: "vercel/ai", skillName: "bad name" },
      ] as never,
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.globalSkillRefs).toEqual([]);
  });

  test("keeps valid globalSkillRefs payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      globalSkillRefs: [
        { source: "vercel/ai", skillName: "ai-sdk" },
        { source: "vercel/ai", skillName: "ai-sdk" },
      ],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.globalSkillRefs).toEqual([
      { source: "vercel/ai", skillName: "ai-sdk" },
    ]);
  });

  test("drops invalid modelVariants payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      globalSkillRefs: [],
      modelVariants: [{ id: "bad-id" }] as never,
      enabledModelIds: [],
    });

    expect(result.modelVariants).toEqual([]);
  });

  test("keeps valid modelVariants payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: true,
      autoCreatePr: true,
      globalSkillRefs: [],
      modelVariants: [
        {
          id: "variant:test",
          name: "Test Variant",
          baseModelId: "openai/gpt-5",
          providerOptions: { reasoningEffort: "low" },
        },
      ],
      enabledModelIds: [],
    });

    expect(result).toEqual({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultDiffMode: "split",
      autoCommitPush: true,
      autoCreatePr: true,
      globalSkillRefs: [],
      modelVariants: [
        {
          id: "variant:test",
          name: "Test Variant",
          baseModelId: "openai/gpt-5",
          providerOptions: { reasoningEffort: "low" },
        },
      ],
      enabledModelIds: [],
    });
  });
});
