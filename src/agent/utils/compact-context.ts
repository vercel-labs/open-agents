import {
  pruneMessages,
  type ModelMessage,
  type StepResult,
  type ToolSet,
} from "ai";

export interface CompactContextOptions<T extends ToolSet> {
  messages: ModelMessage[];
  steps: StepResult<T>[];
  tokenThreshold?: number;
  minTrimSavings?: number;
  protectLastUserMessages?: number;
}

/**
 * Compacts context by removing old tool calls to prevent context overflow.
 *
 * Only removes tool calls that are:
 * 1. Outside the last N user messages window (default: 3)
 * 2. When total context exceeds the token threshold (default: 40k)
 * 3. When there's at least minTrimSavings tokens to save (default: 20k)
 *
 * The protection window includes all messages (user, assistant, tool)
 * from the Nth-to-last user message onwards.
 *
 * This strategy is from OpenCode (https://x.com/thdxr/status/1968083076841607279?s=20)
 */
export function compactContext<T extends ToolSet>({
  messages,
  steps,
  tokenThreshold = 40_000, // adjust
  minTrimSavings = 20_000, // adjust
  protectLastUserMessages = 3, // adjust
}: CompactContextOptions<T>): ModelMessage[] {
  if (messages.length === 0) return messages;

  // Step 1: Get current token usage from the last step
  const currentTokens = getCurrentTokenUsage(steps);
  if (currentTokens <= tokenThreshold) {
    return messages;
  }

  // Step 2: Find cutoff index (where protected window starts)
  const cutoffIndex = findCutoffIndex(messages, protectLastUserMessages);
  if (cutoffIndex === 0) {
    return messages; // All messages are protected
  }

  // Step 3: Estimate tool tokens that would be saved
  const toolTokensToTrim = estimateToolTokensBeforeCutoff(
    messages,
    cutoffIndex,
  );
  if (toolTokensToTrim < minTrimSavings) {
    return messages; // Not enough savings to justify trimming
  }

  // Step 4: Calculate messages to protect and prune
  const messagesToProtect = messages.length - cutoffIndex;

  // When protecting 0 messages, prune all tool calls
  const toolCallsOption =
    messagesToProtect === 0
      ? "all"
      : (`before-last-${messagesToProtect}-messages` as const);

  return pruneMessages({
    messages,
    toolCalls: toolCallsOption,
    emptyMessages: "remove",
  });
}

function getCurrentTokenUsage<T extends ToolSet>(
  steps: StepResult<T>[],
): number {
  if (steps.length === 0) return 0;
  const lastStep = steps[steps.length - 1];
  if (!lastStep) return 0;
  return lastStep.usage?.inputTokens ?? 0;
}

function findCutoffIndex(
  messages: ModelMessage[],
  protectLastUserMessages: number,
): number {
  // Special case: protect nothing, allow pruning all old tool calls
  if (protectLastUserMessages === 0) {
    return messages.length;
  }

  let userMessageCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") {
      userMessageCount++;
      if (userMessageCount >= protectLastUserMessages) {
        return i; // This index and everything after is protected
      }
    }
  }
  return 0; // Protect all if fewer than N user messages
}

function estimateToolTokensBeforeCutoff(
  messages: ModelMessage[],
  cutoffIndex: number,
): number {
  let toolChars = 0;
  for (let i = 0; i < cutoffIndex; i++) {
    const message = messages[i];
    if (message && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "tool-call" || part.type === "tool-result") {
          toolChars += JSON.stringify(part).length;
        }
      }
    }
  }
  return Math.ceil(toolChars / 4);
}
