import { describe, expect, test } from "bun:test";
import {
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
      },
    });
  });

  test("toProviderOptionsByProvider returns undefined when provider options are empty", () => {
    const result = toProviderOptionsByProvider("openai/gpt-5", {});
    expect(result).toBeUndefined();
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

  test("resolveModelSelection marks missing variants", () => {
    const result = resolveModelSelection("variant:missing", []);

    expect(result).toEqual({
      resolvedModelId: "variant:missing",
      isMissingVariant: true,
    });
  });
});
