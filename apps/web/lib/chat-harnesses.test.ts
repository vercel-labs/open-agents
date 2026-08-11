import { describe, expect, test } from "bun:test";
import {
  getPreferredModelProviderForHarness,
  isPreferredModelProviderForHarness,
  resolveHarnessRunModelId,
} from "./chat-harnesses";

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

  test("substitutes the harness default for non-native models", () => {
    expect(
      resolveHarnessRunModelId("codex", "anthropic/claude-haiku-4.5"),
    ).toBe("openai/gpt-5.4");
    expect(resolveHarnessRunModelId("claude-code", "openai/gpt-5.4")).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });

  test("passes any model through for harnesses without a preference", () => {
    expect(resolveHarnessRunModelId("pi", "zai/glm-4.7")).toBe("zai/glm-4.7");
    expect(resolveHarnessRunModelId("open-agent", "zai/glm-4.7")).toBe(
      "zai/glm-4.7",
    );
  });
});
