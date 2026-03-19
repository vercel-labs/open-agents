import type { ModelMessage } from "ai";

export type ToolCallIndex = {
  byLocation: Map<number, Map<number, string>>;
  orderedKeys: string[];
};

export type PendingCompactionCandidates = {
  pendingToolCallKeys: Set<string>;
  pendingAnonymousToolResults: number;
};

type JsonRecord = Record<string, unknown>;

export function indexToolCalls(messages: ModelMessage[]): ToolCallIndex {
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

export function findPendingCompactionCandidates({
  messages,
  toolCallIndex,
  recentToolCallKeys,
  compactedToolNotice,
}: {
  messages: ModelMessage[];
  toolCallIndex: ToolCallIndex;
  recentToolCallKeys: Set<string>;
  compactedToolNotice: string;
}): PendingCompactionCandidates {
  const pendingToolCallKeys = new Set<string>();
  let pendingAnonymousToolResults = 0;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (!message || !Array.isArray(message.content)) continue;

    const partKeys = toolCallIndex.byLocation.get(messageIndex);

    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex];
      if (!part) continue;

      if (isToolCallPart(part)) {
        const key = partKeys?.get(partIndex);
        if (
          key &&
          !recentToolCallKeys.has(key) &&
          !isCompactedToolCallPart(part, compactedToolNotice)
        ) {
          pendingToolCallKeys.add(key);
        }
        continue;
      }

      if (!isToolResultPart(part)) {
        continue;
      }

      const key =
        typeof part.toolCallId === "string" ? `id:${part.toolCallId}` : null;

      if (
        key &&
        !recentToolCallKeys.has(key) &&
        !isCompactedToolResultPart(part, compactedToolNotice)
      ) {
        pendingToolCallKeys.add(key);
      }

      if (!key && !isCompactedToolResultPart(part, compactedToolNotice)) {
        pendingAnonymousToolResults++;
      }
    }
  }

  return {
    pendingToolCallKeys,
    pendingAnonymousToolResults,
  };
}

export function getPendingCompactionUnits(
  pendingCandidates: PendingCompactionCandidates,
): number {
  return (
    pendingCandidates.pendingToolCallKeys.size +
    pendingCandidates.pendingAnonymousToolResults
  );
}

export function estimateCompactionSavings({
  messages,
  toolCallIndex,
  pendingCandidates,
  compactedToolNotice,
}: {
  messages: ModelMessage[];
  toolCallIndex: ToolCallIndex;
  pendingCandidates: PendingCompactionCandidates;
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
        if (
          key &&
          pendingCandidates.pendingToolCallKeys.has(key) &&
          !isCompactedToolCallPart(part, compactedToolNotice)
        ) {
          compactedPart = compactToolCallPart(part, compactedToolNotice);
        }
      } else if (isToolResultPart(part)) {
        const key =
          typeof part.toolCallId === "string" ? `id:${part.toolCallId}` : null;

        if (
          key &&
          pendingCandidates.pendingToolCallKeys.has(key) &&
          !isCompactedToolResultPart(part, compactedToolNotice)
        ) {
          compactedPart = compactToolResultPart(part, compactedToolNotice);
        }

        if (
          !key &&
          pendingCandidates.pendingAnonymousToolResults > 0 &&
          !isCompactedToolResultPart(part, compactedToolNotice)
        ) {
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

export function compactToolData({
  messages,
  toolCallIndex,
  pendingCandidates,
  compactedToolNotice,
}: {
  messages: ModelMessage[];
  toolCallIndex: ToolCallIndex;
  pendingCandidates: PendingCompactionCandidates;
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
        if (
          key &&
          pendingCandidates.pendingToolCallKeys.has(key) &&
          !isCompactedToolCallPart(part, compactedToolNotice)
        ) {
          changed = true;
          return compactToolCallPart(part, compactedToolNotice) as typeof part;
        }
      }

      if (isToolResultPart(part)) {
        const key =
          typeof part.toolCallId === "string" ? `id:${part.toolCallId}` : null;

        if (
          key &&
          pendingCandidates.pendingToolCallKeys.has(key) &&
          !isCompactedToolResultPart(part, compactedToolNotice)
        ) {
          changed = true;
          return compactToolResultPart(
            part,
            compactedToolNotice,
          ) as typeof part;
        }

        if (
          !key &&
          pendingCandidates.pendingAnonymousToolResults > 0 &&
          !isCompactedToolResultPart(part, compactedToolNotice)
        ) {
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

function isCompactedToolCallPart(
  part: JsonRecord,
  compactedToolNotice: string,
): boolean {
  const input = part.input;
  if (!input || typeof input !== "object") {
    return false;
  }

  const normalizedInput = input as {
    compacted?: unknown;
    message?: unknown;
  };

  return (
    normalizedInput.compacted === true &&
    normalizedInput.message === compactedToolNotice
  );
}

function isCompactedToolResultPart(
  part: JsonRecord,
  compactedToolNotice: string,
): boolean {
  const output = part.output;
  if (!output || typeof output !== "object") {
    return false;
  }

  const normalizedOutput = output as {
    type?: unknown;
    value?: unknown;
  };

  return (
    normalizedOutput.type === "text" &&
    normalizedOutput.value === compactedToolNotice
  );
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
