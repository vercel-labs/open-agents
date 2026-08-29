import { describe, expect, test } from "bun:test";
import { EXTERNAL_HARNESS_IDS } from "@open-agents/harness-runner/ids";
import {
  CHAT_HARNESS_IDS,
  CHAT_HARNESS_OPTIONS,
  CHAT_HARNESS_PREFERRED_MODEL_PROVIDERS,
  getChatHarnessDefinition,
  getPreferredModelProviderForHarness,
  isPreferredModelProviderForHarness,
  resolveHarnessRunModelId,
} from "./chat-harnesses";

describe("chat harness registry", () => {
  test("derives the id list from the harness runner", () => {
    expect(CHAT_HARNESS_IDS).toEqual(["open-agent", ...EXTERNAL_HARNESS_IDS]);
  });

  test("derives the selector options from the registry", () => {
    expect(CHAT_HARNESS_OPTIONS.map((option) => option.id)).toEqual([
      ...CHAT_HARNESS_IDS,
    ]);
    for (const option of CHAT_HARNESS_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  test("derives the preferred-provider map from the registry", () => {
    for (const id of CHAT_HARNESS_IDS) {
      expect(CHAT_HARNESS_PREFERRED_MODEL_PROVIDERS[id]).toBe(
        getChatHarnessDefinition(id).provider,
      );
    }
  });

  test("provider-pinned harnesses carry a default model from their native provider", () => {
    for (const id of CHAT_HARNESS_IDS) {
      const definition = getChatHarnessDefinition(id);
      if (!definition.provider) {
        continue;
      }
      expect(
        definition.defaultModelId.startsWith(`${definition.provider}/`),
      ).toBe(true);
    }
  });
});

describe("chat harness model preferences", () => {
  test("prefers the native provider for Codex and Claude Code", () => {
    expect(getPreferredModelProviderForHarness("codex")).toBe("openai");
    expect(getPreferredModelProviderForHarness("claude-code")).toBe(
      "anthropic",
    );
  });

  test("does not constrain provider-neutral harnesses", () => {
    expect(getPreferredModelProviderForHarness("open-agent")).toBeUndefined();
    expect(getPreferredModelProviderForHarness("pi")).toBeUndefined();
    expect(isPreferredModelProviderForHarness("pi", "google")).toBe(true);
  });

  test("identifies non-preferred providers without blocking them", () => {
    expect(isPreferredModelProviderForHarness("codex", "openai")).toBe(true);
    expect(isPreferredModelProviderForHarness("codex", "anthropic")).toBe(
      false,
    );
    expect(isPreferredModelProviderForHarness("claude-code", "anthropic")).toBe(
      true,
    );
    expect(isPreferredModelProviderForHarness("claude-code", "openai")).toBe(
      false,
    );
  });

  test("keeps native-provider models when resolving the run model", () => {
    expect(resolveHarnessRunModelId("codex", "openai/gpt-5.4")).toBe(
      "openai/gpt-5.4",
    );
    expect(
      resolveHarnessRunModelId("claude-code", "anthropic/claude-haiku-4.5"),
    ).toBe("anthropic/claude-haiku-4.5");
  });

  test("substitutes a native-provider default for non-native models", () => {
    // Invariant, not today's constant: whatever the default model ids are
    // repointed to, a provider-pinned harness must resolve to its provider.
    const codexResolved = resolveHarnessRunModelId(
      "codex",
      "anthropic/claude-haiku-4.5",
    );
    expect(codexResolved.startsWith("openai/")).toBe(true);

    const claudeCodeResolved = resolveHarnessRunModelId(
      "claude-code",
      "openai/gpt-5.4",
    );
    expect(claudeCodeResolved.startsWith("anthropic/")).toBe(true);
  });

  test("passes any model through for harnesses without a preference", () => {
    expect(resolveHarnessRunModelId("pi", "zai/glm-4.7")).toBe("zai/glm-4.7");
    expect(resolveHarnessRunModelId("open-agent", "zai/glm-4.7")).toBe(
      "zai/glm-4.7",
    );
  });
});
