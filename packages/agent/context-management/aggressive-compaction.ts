import {
  type ModelMessage,
  pruneMessages,
  type StepResult,
  type ToolSet,
} from "ai";
import {
  compactToolData,
  estimateCompactionSavings,
  findPendingCompactionCandidates,
  getPendingCompactionUnits,
  indexToolCalls,
} from "./aggressive-compaction-helpers";

const DEFAULT_COMPACTED_NOTICE =
  "This tool payload was compacted to save context. Please run the tool again if needed.";

const DEFAULT_TRIGGER_PERCENT = 0.4;
const DEFAULT_FORCE_COMPACTION_PERCENT = 0.8;
const DEFAULT_MIN_SAVINGS_PERCENT = 0.2;
const DEFAULT_CHECKPOINT_TOOL_CALLS = 24;

export interface AggressiveCompactionOptions<T extends ToolSet> {
  messages: ModelMessage[];
  steps: StepResult<T>[];
  contextLimit: number;
  lastInputTokens?: number;
  triggerPercent?: number;
  forceCompactionPercent?: number;
  minSavingsPercent?: number;
  retainRecentToolCalls?: number;
  checkpointToolCalls?: number;
  compactedToolNotice?: string;
}

/**
 * Aggressive single-strategy compaction.
 *
 * Compaction starts when input tokens exceed triggerPercent of the context
 * window. To avoid per-turn cache churn, only newly eligible tool calls are
 * compacted in checkpoints once at least checkpointToolCalls are pending.
 *
 * If input tokens exceed forceCompactionPercent, pending tool calls/results
 * are compacted immediately regardless of checkpoint size or savings threshold
 * to protect against context overflow.
 */
export function aggressiveCompactContext<T extends ToolSet>({
  messages,
  steps,
  contextLimit,
  lastInputTokens,
  triggerPercent = DEFAULT_TRIGGER_PERCENT,
  forceCompactionPercent = DEFAULT_FORCE_COMPACTION_PERCENT,
  minSavingsPercent = DEFAULT_MIN_SAVINGS_PERCENT,
  retainRecentToolCalls = 20,
  checkpointToolCalls = DEFAULT_CHECKPOINT_TOOL_CALLS,
  compactedToolNotice = DEFAULT_COMPACTED_NOTICE,
}: AggressiveCompactionOptions<T>): ModelMessage[] {
  if (messages.length === 0) return messages;

  const normalizedContextLimit = Math.max(1, contextLimit);
  const normalizedTriggerPercent = clampPercentage(triggerPercent);
  const normalizedForcePercent = Math.max(
    normalizedTriggerPercent,
    clampPercentage(forceCompactionPercent),
  );
  const normalizedSavingsPercent = clampPercentage(minSavingsPercent);
  const normalizedCheckpointToolCalls = Math.max(
    1,
    Math.floor(checkpointToolCalls),
  );

  const tokenThreshold = Math.ceil(
    normalizedContextLimit * normalizedTriggerPercent,
  );
  const forceCompactionThreshold = Math.ceil(
    normalizedContextLimit * normalizedForcePercent,
  );
  const minTrimSavings = Math.ceil(
    normalizedContextLimit * normalizedSavingsPercent,
  );

  const currentTokens = getCurrentTokenUsage({
    messages,
    steps,
    lastInputTokens,
  });

  if (currentTokens <= tokenThreshold) {
    return messages;
  }

  const shouldForceCompaction = currentTokens >= forceCompactionThreshold;

  const normalizedRetainCount = Math.max(0, retainRecentToolCalls);
  const toolCallIndex = indexToolCalls(messages);
  const recentToolCallKeys = new Set(
    toolCallIndex.orderedKeys.slice(-normalizedRetainCount),
  );

  const pendingCandidates = findPendingCompactionCandidates({
    messages,
    toolCallIndex,
    recentToolCallKeys,
    compactedToolNotice,
  });

  const pendingCompactionUnits = getPendingCompactionUnits(pendingCandidates);
  if (pendingCompactionUnits === 0) {
    return messages;
  }

  if (
    !shouldForceCompaction &&
    pendingCompactionUnits < normalizedCheckpointToolCalls
  ) {
    return messages;
  }

  const removableToolTokens = estimateCompactionSavings({
    messages,
    toolCallIndex,
    pendingCandidates,
    compactedToolNotice,
  });

  if (removableToolTokens <= 0) {
    return messages;
  }

  if (!shouldForceCompaction && removableToolTokens < minTrimSavings) {
    return messages;
  }

  const compactedMessages = compactToolData({
    messages,
    toolCallIndex,
    pendingCandidates,
    compactedToolNotice,
  });

  return pruneMessages({
    messages: compactedMessages,
    emptyMessages: "remove",
  });
}

function clampPercentage(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function getCurrentTokenUsage<T extends ToolSet>({
  messages,
  steps,
  lastInputTokens,
}: {
  messages: ModelMessage[];
  steps: StepResult<T>[];
  lastInputTokens?: number;
}): number {
  if (typeof lastInputTokens === "number" && lastInputTokens > 0) {
    return lastInputTokens;
  }

  const lastStep = steps[steps.length - 1];
  const inputTokens = lastStep?.usage?.inputTokens;

  if (typeof inputTokens === "number" && inputTokens > 0) {
    return inputTokens;
  }

  return estimateMessageTokens(messages);
}

function estimateMessageTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}
