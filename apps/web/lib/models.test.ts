import { describe, expect, test } from "bun:test";
import { estimateModelUsageCost } from "./models";

describe("estimateModelUsageCost", () => {
  test("uses base pricing below the 200k context threshold", () => {
    expect(
      estimateModelUsageCost(
        {
          inputTokens: 100_000,
          cachedInputTokens: 80_000,
          outputTokens: 1_000,
        },
        {
          input: 2.5,
          output: 15,
          cache_read: 0.25,
          context_over_200k: {
            input: 5,
            output: 22.5,
            cache_read: 0.5,
          },
        },
      ),
    ).toBeCloseTo(0.085, 6);
  });

  test("uses context-over-200k pricing when the prompt exceeds the threshold", () => {
    expect(
      estimateModelUsageCost(
        {
          inputTokens: 250_000,
          cachedInputTokens: 200_000,
          outputTokens: 1_000,
        },
        {
          input: 2.5,
          output: 15,
          cache_read: 0.25,
          context_over_200k: {
            input: 5,
            output: 22.5,
            cache_read: 0.5,
          },
        },
      ),
    ).toBeCloseTo(0.3725, 6);
  });
});
