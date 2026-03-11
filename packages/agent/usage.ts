import {
  getToolName,
  isToolUIPart,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";

export type TaskToolUsageEvent = {
  usage: LanguageModelUsage;
  modelId?: string;
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

export function addLanguageModelUsage(
  usage1: LanguageModelUsage,
  usage2: LanguageModelUsage,
): LanguageModelUsage {
  return {
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
    reasoningTokens: addTokenCounts(
      usage1.reasoningTokens,
      usage2.reasoningTokens,
    ),
    cachedInputTokens: addTokenCounts(
      usage1.cachedInputTokens,
      usage2.cachedInputTokens,
    ),
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
    isNumber(value.totalTokens) ||
    isNumber(value.cachedInputTokens) ||
    isNumber(value.reasoningTokens)
  );
}

function extractTaskOutputUsage(
  output: unknown,
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
    return { usage, modelId };
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
    return { usage: totalMessageUsage, modelId: legacyModelId };
  }
  const lastStepUsage = metadata.lastStepUsage;
  if (isLanguageModelUsage(lastStepUsage)) {
    return { usage: lastStepUsage, modelId: legacyModelId };
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
    const usage = extractTaskOutputUsage(part.output);
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
