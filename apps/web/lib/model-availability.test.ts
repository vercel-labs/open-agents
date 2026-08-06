import { describe, expect, test } from "bun:test";

import {
  filterDisabledModels,
  isModelDisabled,
  resolveAvailableModelId,
} from "./model-availability";
import { APP_DEFAULT_MODEL_ID } from "./models";

describe("model availability", () => {
  test("disables OpenAI GPT pro models", () => {
    expect(isModelDisabled("openai/gpt-5.4-pro")).toBe(true);
    expect(isModelDisabled("openai/gpt-5.5-pro")).toBe(true);
    expect(isModelDisabled("openai/gpt-5.5-pro-preview")).toBe(false);
    expect(isModelDisabled("openai/gpt-5.5")).toBe(false);
    expect(isModelDisabled("openai/o1-pro")).toBe(false);
  });

  test("filters disabled models from available model lists", () => {
    const models = [
      { id: "openai/gpt-5.5", name: "GPT 5.5" },
      { id: "openai/gpt-5.5-pro", name: "GPT 5.5 Pro" },
      { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    ];

    expect(filterDisabledModels(models)).toEqual([
      { id: "openai/gpt-5.5", name: "GPT 5.5" },
      { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    ]);
  });

  test("resolves disabled model selections to the app default", () => {
    expect(resolveAvailableModelId("openai/gpt-5.5-pro")).toBe(
      APP_DEFAULT_MODEL_ID,
    );
    expect(resolveAvailableModelId("openai/gpt-5.5")).toBe("openai/gpt-5.5");
  });
});
