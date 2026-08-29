import { describe, expect, test } from "bun:test";
import type { LanguageModelUsage } from "ai";

import { addLanguageModelUsage } from "./usage.ts";

function usage(overrides: Record<string, unknown>): LanguageModelUsage {
  return overrides as LanguageModelUsage;
}

describe("addLanguageModelUsage", () => {
  test("sums token counts and detail fields", () => {
    const sum = addLanguageModelUsage(
      usage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        inputTokenDetails: { cacheReadTokens: 4 },
      }),
      usage({
        inputTokens: 20,
        outputTokens: 1,
        totalTokens: 21,
        inputTokenDetails: { cacheReadTokens: 6 },
      }),
    );

    expect(sum.inputTokens).toBe(30);
    expect(sum.outputTokens).toBe(6);
    expect(sum.totalTokens).toBe(36);
    expect(sum.inputTokenDetails?.cacheReadTokens).toBe(10);
  });

  test("carries legacy top-level cachedInputTokens through summation", () => {
    const sum = addLanguageModelUsage(
      usage({ inputTokens: 10, cachedInputTokens: 7 }),
      usage({ inputTokens: 20, cachedInputTokens: 3 }),
    );

    expect((sum as unknown as Record<string, unknown>).cachedInputTokens).toBe(
      10,
    );
  });

  test("omits legacy cachedInputTokens when neither side has it", () => {
    const sum = addLanguageModelUsage(
      usage({ inputTokens: 10 }),
      usage({ inputTokens: 20 }),
    );

    expect("cachedInputTokens" in sum).toBe(false);
  });
});
