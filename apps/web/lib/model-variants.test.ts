import { describe, expect, test } from "bun:test";
import {
  BUILT_IN_VARIANT_ID_PREFIX,
  BUILT_IN_VARIANTS,
  getAllVariants,
  isBuiltInVariant,
  resolveModelSelection,
  toProviderOptionsByProvider,
  type ModelVariant,
} from "./model-variants";

describe("model variants", () => {
  test("toProviderOptionsByProvider maps flat provider options to model provider", () => {
    const result = toProviderOptionsByProvider("openai/gpt-5", {
      reasoningEffort: "medium",
      reasoningSummary: "detailed",
    });

    expect(result).toEqual({
      openai: {
        reasoningEffort: "medium",
        reasoningSummary: "detailed",
        store: false,
      },
    });
  });

  test("toProviderOptionsByProvider injects store false for OpenAI variants even when provider options are empty", () => {
    const result = toProviderOptionsByProvider("openai/gpt-5", {});

    expect(result).toEqual({
      openai: {
        store: false,
      },
    });
  });

  test("toProviderOptionsByProvider returns undefined for non-OpenAI variants with no provider options", () => {
    const result = toProviderOptionsByProvider("anthropic/claude-opus-4.6", {});
    expect(result).toBeUndefined();
  });

  test("toProviderOptionsByProvider forces store false for OpenAI variants", () => {
    const result = toProviderOptionsByProvider("openai/gpt-5", {
      reasoningEffort: "medium",
      store: true,
    });

    expect(result).toEqual({
      openai: {
        reasoningEffort: "medium",
        store: false,
      },
    });
  });

  test("isBuiltInVariant returns true for built-in ids and false for user ids", () => {
    expect(isBuiltInVariant("variant:builtin:gpt-5.4-xhigh")).toBe(true);
    expect(isBuiltInVariant("variant:openai-medium")).toBe(false);
  });

  test("BUILT_IN_VARIANTS has expected shape and ids", () => {
    expect(BUILT_IN_VARIANTS).toHaveLength(2);
    for (const variant of BUILT_IN_VARIANTS) {
      expect(variant.id.startsWith(BUILT_IN_VARIANT_ID_PREFIX)).toBe(true);
    }
  });

  test("getAllVariants prepends built-in variants to user variants", () => {
    const userVariants: ModelVariant[] = [
      {
        id: "variant:openai-medium",
        name: "OpenAI Medium Reasoning",
        baseModelId: "openai/gpt-5",
        providerOptions: {
          reasoningEffort: "medium",
        },
      },
    ];

    const result = getAllVariants(userVariants);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(BUILT_IN_VARIANTS[0]);
    expect(result[1]).toEqual(BUILT_IN_VARIANTS[1]);
    expect(result[2]).toEqual(userVariants[0]);
  });

  test("resolveModelSelection returns base model unchanged when id is not a variant", () => {
    const result = resolveModelSelection("openai/gpt-5", []);

    expect(result).toEqual({
      resolvedModelId: "openai/gpt-5",
      isMissingVariant: false,
    });
  });

  test("resolveModelSelection resolves variant to base model with provider options", () => {
    const variants: ModelVariant[] = [
      {
        id: "variant:openai-medium",
        name: "OpenAI Medium Reasoning",
        baseModelId: "openai/gpt-5",
        providerOptions: {
          reasoningEffort: "medium",
          store: false,
        },
      },
    ];

    const result = resolveModelSelection("variant:openai-medium", variants);

    expect(result).toEqual({
      resolvedModelId: "openai/gpt-5",
      providerOptionsByProvider: {
        openai: {
          reasoningEffort: "medium",
          store: false,
        },
      },
      isMissingVariant: false,
    });
  });

  test("resolveModelSelection resolves built-in variants", () => {
    const result = resolveModelSelection(
      "variant:builtin:gpt-5.4-xhigh",
      BUILT_IN_VARIANTS,
    );

    expect(result).toEqual({
      resolvedModelId: "openai/gpt-5.4",
      providerOptionsByProvider: {
        openai: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          store: false,
        },
      },
      isMissingVariant: false,
    });
  });

  test("resolveModelSelection marks missing variants", () => {
    const result = resolveModelSelection("variant:missing", []);

    expect(result).toEqual({
      resolvedModelId: "variant:missing",
      isMissingVariant: true,
    });
  });
});
