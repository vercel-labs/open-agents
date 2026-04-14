import { describe, expect, test } from "bun:test";
import type { ModelVariant } from "@/lib/model-variants";
import {
  buildModelOptions,
  getDefaultModelOptionId,
  withMissingModelOption,
} from "./model-options";
import type { AvailableModel } from "./models";

function createModel(input: {
  id: string;
  name?: string;
  description?: string | null;
  contextWindow?: number;
}): AvailableModel {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    context_window: input.contextWindow,
    modelType: "language",
  } as unknown as AvailableModel;
}

describe("model options", () => {
  test("buildModelOptions includes base models and variants", () => {
    const models: AvailableModel[] = [
      createModel({
        id: "openai/gpt-5",
        name: "GPT-5",
        description: "Base model",
        contextWindow: 400_000,
      }),
    ];

    const variants: ModelVariant[] = [
      {
        id: "variant:gpt-5-medium",
        name: "GPT-5 Medium Reasoning",
        baseModelId: "openai/gpt-5",
        providerOptions: { reasoningEffort: "medium" },
      },
    ];

    const options = buildModelOptions(models, variants);

    expect(options).toEqual([
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        description: "Base model",
        isVariant: false,
        contextWindow: 400_000,
      },
      {
        id: "variant:gpt-5-medium",
        label: "GPT-5 Medium Reasoning",
        description: "Variant of GPT-5",
        isVariant: true,
        contextWindow: 400_000,
      },
    ]);
  });

  test("withMissingModelOption appends missing variant option", () => {
    const result = withMissingModelOption([], "variant:removed");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "variant:removed",
      label: "removed (missing)",
      description: "Variant no longer exists",
      isVariant: true,
      contextWindow: undefined,
    });
  });

  test("withMissingModelOption does not append non-variant ids", () => {
    const original = [
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        isVariant: false,
      },
    ];

    expect(withMissingModelOption(original, "openai/unknown-model")).toBe(
      original,
    );
  });

  test("withMissingModelOption returns original list when id already exists", () => {
    const original = [
      {
        id: "variant:existing",
        label: "Existing Variant",
        isVariant: true,
      },
    ];

    expect(withMissingModelOption(original, "variant:existing")).toBe(original);
  });

  test("getDefaultModelOptionId prefers repository default model when present", () => {
    const options = [
      {
        id: "openai/gpt-5.4",
        label: "GPT-5.4",
        isVariant: false,
      },
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        isVariant: false,
      },
    ];

    expect(getDefaultModelOptionId(options)).toBe("openai/gpt-5.4");
  });

  test("getDefaultModelOptionId falls back to first option when default is missing", () => {
    const options = [
      {
        id: "openai/gpt-5",
        label: "GPT-5",
        isVariant: false,
      },
    ];

    expect(getDefaultModelOptionId(options)).toBe("openai/gpt-5");
  });
});
