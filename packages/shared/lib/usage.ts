import type { LanguageModelUsage } from "ai";

/**
 * Canonical token-usage arithmetic for the monorepo.
 *
 * This module must stay free of runtime imports (the `ai` import above is
 * type-only) so it is safe to use from any context, including bundles that
 * cannot carry Node.js modules.
 *
 * Known deliberate copy: `apps/web/app/workflows/usage-utils.ts` keeps a
 * workflow-local duplicate because the `"use workflow"` bundle must not pull
 * workspace packages at runtime; a drift test in that directory asserts the
 * two implementations stay identical.
 */

/** Sum two optional numbers, staying undefined when both are absent. */
export function sumOptionalNumbers(
  value1: number | undefined,
  value2: number | undefined,
): number | undefined {
  if (value1 == null && value2 == null) {
    return undefined;
  }
  return (value1 ?? 0) + (value2 ?? 0);
}

/**
 * Usage persisted before AI SDK 7 carries cached tokens in a top-level
 * `cachedInputTokens` field instead of inputTokenDetails.
 */
export function legacyCachedInputTokens(
  usage: LanguageModelUsage,
): number | undefined {
  const value = (usage as unknown as Record<string, unknown>).cachedInputTokens;
  return typeof value === "number" ? value : undefined;
}

export function addLanguageModelUsage(
  usage1: LanguageModelUsage,
  usage2: LanguageModelUsage,
): LanguageModelUsage {
  // Keep summing the legacy top-level field so aggregated legacy events do
  // not lose their cached-token counts.
  const legacyCached = sumOptionalNumbers(
    legacyCachedInputTokens(usage1),
    legacyCachedInputTokens(usage2),
  );

  return {
    ...(legacyCached !== undefined ? { cachedInputTokens: legacyCached } : {}),
    inputTokens: sumOptionalNumbers(usage1.inputTokens, usage2.inputTokens),
    inputTokenDetails: {
      noCacheTokens: sumOptionalNumbers(
        usage1.inputTokenDetails?.noCacheTokens,
        usage2.inputTokenDetails?.noCacheTokens,
      ),
      cacheReadTokens: sumOptionalNumbers(
        usage1.inputTokenDetails?.cacheReadTokens,
        usage2.inputTokenDetails?.cacheReadTokens,
      ),
      cacheWriteTokens: sumOptionalNumbers(
        usage1.inputTokenDetails?.cacheWriteTokens,
        usage2.inputTokenDetails?.cacheWriteTokens,
      ),
    },
    outputTokens: sumOptionalNumbers(usage1.outputTokens, usage2.outputTokens),
    outputTokenDetails: {
      textTokens: sumOptionalNumbers(
        usage1.outputTokenDetails?.textTokens,
        usage2.outputTokenDetails?.textTokens,
      ),
      reasoningTokens: sumOptionalNumbers(
        usage1.outputTokenDetails?.reasoningTokens,
        usage2.outputTokenDetails?.reasoningTokens,
      ),
    },
    totalTokens: sumOptionalNumbers(usage1.totalTokens, usage2.totalTokens),
  };
}

export function sumLanguageModelUsage(
  usage1: LanguageModelUsage | undefined,
  usage2: LanguageModelUsage | undefined,
): LanguageModelUsage | undefined {
  if (!usage1) {
    return usage2;
  }
  if (!usage2) {
    return usage1;
  }
  return addLanguageModelUsage(usage1, usage2);
}
