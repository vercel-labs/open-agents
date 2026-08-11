import { describe, expect, test } from "bun:test";
import {
  addHarnessUsage,
  extractHarnessCostUsd,
  harnessUsageFromMetadataValue,
} from "./usage.ts";

describe("extractHarnessCostUsd", () => {
  test("reads cumulative Claude Code cost metadata", () => {
    expect(
      extractHarnessCostUsd("claude-code", {
        "claude-code": {
          costUsd: 0.0123,
        },
      }),
    ).toBe(0.0123);
  });

  test("ignores missing or invalid cost metadata", () => {
    expect(extractHarnessCostUsd("claude-code", undefined)).toBeUndefined();
    expect(
      extractHarnessCostUsd("claude-code", {
        "claude-code": {
          costUsd: "0.0123",
        },
      }),
    ).toBeUndefined();
  });

  test("returns undefined for harnesses without a cost metadata key", () => {
    expect(
      extractHarnessCostUsd("codex", {
        "claude-code": { costUsd: 0.0123 },
      }),
    ).toBeUndefined();
  });
});

describe("addHarnessUsage", () => {
  test("sums token counts, legacy fields, and dollar cost", () => {
    expect(
      addHarnessUsage(
        {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: 4,
          reasoningTokens: 2,
          inputTokenDetails: {
            noCacheTokens: 6,
            cacheReadTokens: 4,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: { textTokens: 3, reasoningTokens: 2 },
          costUsd: 0.01,
        },
        {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
          cachedInputTokens: 8,
          reasoningTokens: 1,
          inputTokenDetails: {
            noCacheTokens: 12,
            cacheReadTokens: 8,
            cacheWriteTokens: 2,
          },
          outputTokenDetails: { textTokens: 9, reasoningTokens: 1 },
          costUsd: 0.02,
        },
      ),
    ).toEqual({
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
      cachedInputTokens: 12,
      reasoningTokens: 3,
      inputTokenDetails: {
        noCacheTokens: 18,
        cacheReadTokens: 12,
        cacheWriteTokens: 2,
      },
      outputTokenDetails: { textTokens: 12, reasoningTokens: 3 },
      costUsd: 0.03,
    });
  });

  test("keeps absent optional fields sparse", () => {
    const summed = addHarnessUsage(
      {
        inputTokens: 1,
        outputTokens: undefined,
        totalTokens: 1,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      {
        inputTokens: 2,
        outputTokens: undefined,
        totalTokens: 2,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    );

    expect(summed.inputTokens).toBe(3);
    expect(summed.costUsd).toBeUndefined();
    expect("costUsd" in summed).toBeFalse();
    expect(summed.reasoningTokens).toBeUndefined();
  });
});

describe("harnessUsageFromMetadataValue", () => {
  test("accepts a persisted usage payload", () => {
    expect(
      harnessUsageFromMetadataValue({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 4,
        costUsd: 0.01,
        inputTokenDetails: { cacheReadTokens: 4 },
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: 4,
      costUsd: 0.01,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 4,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: {
        textTokens: undefined,
        reasoningTokens: undefined,
      },
    });
  });

  test("rejects values that are not usage objects", () => {
    expect(harnessUsageFromMetadataValue(undefined)).toBeUndefined();
    expect(harnessUsageFromMetadataValue("usage")).toBeUndefined();
    expect(harnessUsageFromMetadataValue(42)).toBeUndefined();
    expect(
      harnessUsageFromMetadataValue({ inputTokens: "10" }),
    ).toBeUndefined();
    expect(
      harnessUsageFromMetadataValue({
        inputTokenDetails: { cacheReadTokens: "4" },
      }),
    ).toBeUndefined();
  });
});
