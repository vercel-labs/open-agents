import type { LanguageModelUsage } from "ai";

/**
 * Workflow-local copy of `addLanguageModelUsage` from `@open-agents/agent`.
 *
 * DO NOT replace this with an import from `@open-agents/agent`. This module
 * is imported by `chat.ts`, whose `"use workflow"` function runs as a
 * deterministic state machine: the workflow bundle must not contain Node.js
 * modules, and the agent package pulls them in transitively. That is why
 * every other `@open-agents/*` import in the workflow modules is type-only.
 *
 * Keep this function in sync with `packages/agent/usage.ts`.
 */

function addTokenCounts(
  tokenCount1: number | undefined,
  tokenCount2: number | undefined,
): number | undefined {
  if (tokenCount1 == null && tokenCount2 == null) {
    return undefined;
  }
  return (tokenCount1 ?? 0) + (tokenCount2 ?? 0);
}

function legacyCachedInputTokens(
  usage: LanguageModelUsage,
): number | undefined {
  const value = (usage as unknown as Record<string, unknown>).cachedInputTokens;
  return typeof value === "number" ? value : undefined;
}

export function addLanguageModelUsage(
  usage1: LanguageModelUsage,
  usage2: LanguageModelUsage,
): LanguageModelUsage {
  // Usage persisted before AI SDK 7 carries cached tokens in a top-level
  // `cachedInputTokens` field instead of inputTokenDetails; keep summing it
  // so aggregated legacy events do not lose their cached-token counts.
  const legacyCached = addTokenCounts(
    legacyCachedInputTokens(usage1),
    legacyCachedInputTokens(usage2),
  );

  return {
    ...(legacyCached !== undefined ? { cachedInputTokens: legacyCached } : {}),
    inputTokens: addTokenCounts(usage1.inputTokens, usage2.inputTokens),
    inputTokenDetails: {
      noCacheTokens: addTokenCounts(
        usage1.inputTokenDetails?.noCacheTokens,
        usage2.inputTokenDetails?.noCacheTokens,
      ),
      cacheReadTokens: addTokenCounts(
        usage1.inputTokenDetails?.cacheReadTokens,
        usage2.inputTokenDetails?.cacheReadTokens,
      ),
      cacheWriteTokens: addTokenCounts(
        usage1.inputTokenDetails?.cacheWriteTokens,
        usage2.inputTokenDetails?.cacheWriteTokens,
      ),
    },
    outputTokens: addTokenCounts(usage1.outputTokens, usage2.outputTokens),
    outputTokenDetails: {
      textTokens: addTokenCounts(
        usage1.outputTokenDetails?.textTokens,
        usage2.outputTokenDetails?.textTokens,
      ),
      reasoningTokens: addTokenCounts(
        usage1.outputTokenDetails?.reasoningTokens,
        usage2.outputTokenDetails?.reasoningTokens,
      ),
    },
    totalTokens: addTokenCounts(usage1.totalTokens, usage2.totalTokens),
  };
}
