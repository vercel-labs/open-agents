import { describe, expect, test } from "bun:test";
import type { LanguageModelUsage } from "ai";
import { addLanguageModelUsage as addShared } from "@open-agents/shared/lib/usage";
import { addLanguageModelUsage as addLocal } from "./usage-utils";

// The workflow bundle cannot import workspace packages at runtime, so
// usage-utils.ts keeps a local copy of the shared implementation. This test
// fails when the two drift apart.

const usage = (overrides: Record<string, unknown>): LanguageModelUsage =>
  overrides as LanguageModelUsage;

const cases: Array<[string, LanguageModelUsage, LanguageModelUsage]> = [
  ["empty payloads", usage({}), usage({})],
  [
    "top-level token counts",
    usage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    usage({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
  ],
  [
    "sparse fields stay sparse",
    usage({ inputTokens: 10 }),
    usage({ outputTokens: 5 }),
  ],
  [
    "input and output token details",
    usage({
      inputTokenDetails: {
        noCacheTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
      },
      outputTokenDetails: { textTokens: 4, reasoningTokens: 5 },
    }),
    usage({
      inputTokenDetails: { cacheReadTokens: 7 },
      outputTokenDetails: { reasoningTokens: 8 },
    }),
  ],
  [
    "legacy top-level cachedInputTokens",
    usage({ cachedInputTokens: 100, inputTokens: 10 }),
    usage({ cachedInputTokens: 50 }),
  ],
  [
    "legacy field on one side only",
    usage({ cachedInputTokens: 100 }),
    usage({ inputTokenDetails: { cacheReadTokens: 7 } }),
  ],
];

describe("usage-utils drift protection", () => {
  for (const [name, usage1, usage2] of cases) {
    test(`matches shared implementation: ${name}`, () => {
      expect(addLocal(usage1, usage2)).toEqual(addShared(usage1, usage2));
    });
  }
});
