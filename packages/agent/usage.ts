import {
  getToolName,
  isToolUIPart,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";

export type TaskToolUsageEvent = {
  usage: LanguageModelUsage;
  modelId?: string;
  toolCallId?: string;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLanguageModelUsage(value: unknown): value is LanguageModelUsage {
  if (!isRecord(value)) {
    return false;
  }
  const inputTokenDetails = value.inputTokenDetails;
  const outputTokenDetails = value.outputTokenDetails;
  return (
    isRecord(inputTokenDetails) ||
    isRecord(outputTokenDetails) ||
    isNumber(value.inputTokens) ||
    isNumber(value.outputTokens) ||
    isNumber(value.totalTokens)
  );
}

function extractTaskOutputUsage(
  output: unknown,
  toolCallId?: string,
): TaskToolUsageEvent | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  // New output shape: {
  //   usage?: LanguageModelUsage,
  //   final?: ModelMessage[],
  //   modelId?: string,
  // }
  const usage = output.usage;
  const modelId =
    typeof output.modelId === "string" ? output.modelId : undefined;
  if (isLanguageModelUsage(usage)) {
    return { usage, modelId, toolCallId };
  }

  // Legacy fallback: { metadata: { totalMessageUsage?, lastStepUsage?, modelId? } }
  const metadata = output.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const legacyModelId =
    typeof metadata.modelId === "string" ? metadata.modelId : undefined;
  const totalMessageUsage = metadata.totalMessageUsage;
  if (isLanguageModelUsage(totalMessageUsage)) {
    return { usage: totalMessageUsage, modelId: legacyModelId, toolCallId };
  }
  const lastStepUsage = metadata.lastStepUsage;
  if (isLanguageModelUsage(lastStepUsage)) {
    return { usage: lastStepUsage, modelId: legacyModelId, toolCallId };
  }
  return undefined;
}

export function collectTaskToolUsageEvents(
  message: UIMessage,
): TaskToolUsageEvent[] {
  const events: TaskToolUsageEvent[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part)) {
      continue;
    }
    const toolName = getToolName(part);
    if (toolName !== "task" && part.type !== "tool-task") {
      continue;
    }
    if (!part.output) {
      continue;
    }
    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : undefined;
    const usage = extractTaskOutputUsage(part.output, toolCallId);
    if (!usage) {
      continue;
    }
    events.push(usage);
  }
  return events;
}

export function collectTaskToolUsage(
  message: UIMessage,
): LanguageModelUsage | undefined {
  const events = collectTaskToolUsageEvents(message);
  let totalUsage: LanguageModelUsage | undefined;
  for (const event of events) {
    totalUsage = totalUsage
      ? addLanguageModelUsage(totalUsage, event.usage)
      : event.usage;
  }
  return totalUsage;
}
