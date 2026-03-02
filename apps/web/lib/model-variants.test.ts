import { describe, expect, test } from "bun:test";
import {
  parseModelVariants,
  resolveModelSelection,
  toProviderOptionsByProvider,
  type ModelVariant,
} from "./model-variants";

const sampleVariant: ModelVariant = {
  id: "variant:codex-thinking-xhigh",
  name: "Codex Thinking XHigh",
  baseModelId: "openai/gpt-5.3-codex",
  providerOptions: {
    reasoningEffort: "high",
    reasoningSummary: "detailed",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("model variants helpers", () => {
  test("parseModelVariants returns empty array for invalid payload", () => {
    expect(parseModelVariants({ foo: "bar" })).toEqual([]);
  });

  test("resolveModelSelection returns base model when selection is not a variant", () => {
    const resolved = resolveModelSelection("anthropic/claude-haiku-4.5", [
      sampleVariant,
    ]);

    expect(resolved.missingVariant).toBe(false);
    expect(resolved.resolvedModelId).toBe("anthropic/claude-haiku-4.5");
    expect(resolved.providerOptionsByProvider).toBeUndefined();
  });

  test("resolveModelSelection maps variant ID to base model and provider options", () => {
    const resolved = resolveModelSelection(sampleVariant.id, [sampleVariant]);

    expect(resolved.missingVariant).toBe(false);
    expect(resolved.resolvedModelId).toBe(sampleVariant.baseModelId);
    expect(resolved.providerOptionsByProvider).toEqual({
      openai: sampleVariant.providerOptions,
    });
  });

  test("resolveModelSelection marks missing variants", () => {
    const resolved = resolveModelSelection("variant:missing", [sampleVariant]);

    expect(resolved.missingVariant).toBe(true);
    expect(resolved.resolvedModelId).toBe("variant:missing");
    expect(resolved.providerOptionsByProvider).toBeUndefined();
  });

  test("toProviderOptionsByProvider returns undefined for empty options", () => {
    expect(
      toProviderOptionsByProvider("openai/gpt-4o-mini", {}),
    ).toBeUndefined();
  });
});
