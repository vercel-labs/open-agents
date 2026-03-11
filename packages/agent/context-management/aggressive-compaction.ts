import {
  type ModelMessage,
  pruneMessages,
  type StepResult,
  type ToolSet,
} from "ai";

const DEFAULT_COMPACTED_NOTICE =
  "This tool payload was compacted to save context. Please run the tool again if needed.";

const DEFAULT_TRIGGER_PERCENT = 0.4;
const DEFAULT_MIN_SAVINGS_PERCENT = 0.2;

export interface AggressiveCompactionOptions<T extends ToolSet> {
  messages: ModelMessage[];
  steps: StepResult<T>[];
  contextLimit: number;
  lastInputTokens?: number;
  triggerPercent?: number;
  minSavingsPercent?: number;
  retainRecentToolCalls?: number;
  compactedToolNotice?: string;
}

type ToolCallIndex = {
  byLocation: Map<number, Map<number, string>>;
  orderedKeys: string[];
};

type JsonRecord = Record<string, unknown>;

/**
 * Aggressive single-strategy compaction.
 *
 * If input tokens exceed triggerPercent of the context window and estimated
 * savings from compacting older tool content are at least minSavingsPercent
 * of the context window, older tool calls/results are compacted while
 * retaining the most recent tool calls.
 */
export function aggressiveCompactContext<T extends ToolSet>({
  messages,
  steps,
  contextLimit,
  lastInputTokens,
  triggerPercent = DEFAULT_TRIGGER_PERCENT,
  minSavingsPercent = DEFAULT_MIN_SAVINGS_PERCENT,
  retainRecentToolCalls = 20,
  compactedToolNotice = DEFAULT_COMPACTED_NOTICE,
}: AggressiveCompactionOptions<T>): ModelMessage[] {
  if (messages.length === 0) return messages;

  const normalizedContextLimit = Math.max(1, contextLimit);
  const normalizedTriggerPercent = clampPercentage(triggerPercent);
  const normalizedSavingsPercent = clampPercentage(minSavingsPercent);

  const tokenThreshold = Math.ceil(
    normalizedContextLimit * normalizedTriggerPercent,
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

  const normalizedRetainCount = Math.max(0, retainRecentToolCalls);
  const toolCallIndex = indexToolCalls(messages);
  const recentToolCallKeys = new Set(
    toolCallIndex.orderedKeys.slice(-normalizedRetainCount),
  );

  const removableToolTokens = estimateCompactionSavings({
    messages,
    toolCallIndex,
    recentToolCallKeys,
    compactedToolNotice,
  });

  if (removableToolTokens < minTrimSavings) {
    return messages;
  }

  const compactedMessages = compactToolData({
    messages,
    toolCallIndex,
    recentToolCallKeys,
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

function indexToolCalls(messages: ModelMessage[]): ToolCallIndex {
  const byLocation = new Map<number, Map<number, string>>();
  const orderedKeys: string[] = [];
  let anonymousCallIndex = 0;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (!message || !Array.isArray(message.content)) continue;

    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex];
      if (!isToolCallPart(part)) continue;

      const key =
        typeof part.toolCallId === "string"
          ? `id:${part.toolCallId}`
          : `anon:${anonymousCallIndex++}`;

      const indexedParts =
        byLocation.get(messageIndex) ?? new Map<number, string>();
      indexedParts.set(partIndex, key);
      byLocation.set(messageIndex, indexedParts);
      orderedKeys.push(key);
    }
  }

  return { byLocation, orderedKeys };
}

function estimateCompactionSavings({
  messages,
  toolCallIndex,
  recentToolCallKeys,
  compactedToolNotice,
}: {
  messages: ModelMessage[];
  toolCallIndex: ToolCallIndex;
  recentToolCallKeys: Set<string>;
  compactedToolNotice: string;
}): number {
  let savingsChars = 0;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (!message || !Array.isArray(message.content)) continue;

    const partKeys = toolCallIndex.byLocation.get(messageIndex);

    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex];
      if (!part) continue;

      const oldLength = JSON.stringify(part).length;
      let compactedPart: JsonRecord | null = null;

      if (isToolCallPart(part)) {
        const key = partKeys?.get(partIndex);
        if (key && !recentToolCallKeys.has(key)) {
          compactedPart = compactToolCallPart(part, compactedToolNotice);
        }
      } else if (isToolResultPart(part)) {
        const key =
          typeof part.toolCallId === "string" ? `id:${part.toolCallId}` : null;
        if (!key || !recentToolCallKeys.has(key)) {
          compactedPart = compactToolResultPart(part, compactedToolNotice);
        }
      }

      if (!compactedPart) {
        continue;
      }

      const newLength = JSON.stringify(compactedPart).length;
      const delta = oldLength - newLength;
      if (delta > 0) {
        savingsChars += delta;
      }
    }
  }

  return Math.ceil(savingsChars / 4);
}

function compactToolData({
  messages,
  toolCallIndex,
  recentToolCallKeys,
  compactedToolNotice,
}: {
  messages: ModelMessage[];
  toolCallIndex: ToolCallIndex;
  recentToolCallKeys: Set<string>;
  compactedToolNotice: string;
}): ModelMessage[] {
  return messages.map((message, messageIndex) => {
    if (!message || !Array.isArray(message.content)) {
      return message;
    }

    const partKeys = toolCallIndex.byLocation.get(messageIndex);
    let changed = false;

    const compactedContent = message.content.map((part, partIndex) => {
      if (!part) return part;

      if (isToolCallPart(part)) {
        const key = partKeys?.get(partIndex);
        if (key && !recentToolCallKeys.has(key)) {
          changed = true;
          return compactToolCallPart(part, compactedToolNotice) as typeof part;
        }
      }

      if (isToolResultPart(part)) {
        const key =
          typeof part.toolCallId === "string" ? `id:${part.toolCallId}` : null;
        if (!key || !recentToolCallKeys.has(key)) {
          changed = true;
          return compactToolResultPart(
            part,
            compactedToolNotice,
          ) as typeof part;
        }
      }

      return part;
    });

    if (!changed) {
      return message;
    }

    return {
      ...message,
      content: compactedContent,
    } as ModelMessage;
  });
}

function compactToolCallPart(
  part: JsonRecord,
  compactedToolNotice: string,
): JsonRecord {
  return {
    ...part,
    input: {
      compacted: true,
      message: compactedToolNotice,
    },
  };
}

function compactToolResultPart(
  part: JsonRecord,
  compactedToolNotice: string,
): JsonRecord {
  return {
    ...part,
    output: {
      type: "text",
      value: compactedToolNotice,
    },
  };
}

function isToolCallPart(
  part: unknown,
): part is JsonRecord & { toolCallId?: unknown } {
  if (!part || typeof part !== "object") return false;
  return (part as { type?: unknown }).type === "tool-call";
}

function isToolResultPart(
  part: unknown,
): part is JsonRecord & { toolCallId?: unknown } {
  if (!part || typeof part !== "object") return false;
  return (part as { type?: unknown }).type === "tool-result";
}
