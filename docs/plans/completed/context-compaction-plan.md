# Context Compaction Implementation Plan

## Overview

Implement a utility function that compacts context by trimming old tool calls to prevent context window overflow during long conversations.

## Requirements

1. **Token threshold**: Only compact when total context exceeds 40k tokens
2. **Minimum savings**: Only trim if there's at least 20k tokens worth of tool calls to remove
3. **Protection window**: Never trim tool calls within the last 3 user messages window (includes all assistant and tool messages within that window)
4. **Single-line usage**: Callable as a one-liner in `prepareStep`
5. **Return type**: Returns updated `ModelMessage[]`

## Protection Window Explained

The protection window is defined by the last 3 user messages. All messages that fall within this window are protected, including:
- The user messages themselves
- Assistant messages between/after user messages
- Tool result messages

Example message sequence:
```
[0] user      <- CAN trim tool calls here
[1] assistant <- CAN trim tool calls here
[2] tool      <- CAN trim tool calls here
[3] user      <- PROTECTED (3rd-to-last user message)
[4] assistant <- PROTECTED
[5] tool      <- PROTECTED
[6] user      <- PROTECTED (2nd-to-last user message)
[7] assistant <- PROTECTED
[8] user      <- PROTECTED (last user message)
[9] assistant <- PROTECTED
```

## Key Insight: Using Step Usage Data

Each step in `prepareStep` contains actual usage information, eliminating the need for token estimation:

```typescript
prepareStep: ({ messages, model, steps }) => {
  // steps contains usage data for each previous step
  // Each step has: step.usage.inputTokens, step.usage.outputTokens, step.usage.totalTokens
}
```

## Function Signature

```typescript
interface CompactContextOptions {
  messages: ModelMessage[];
  steps: StepResult[];
  tokenThreshold?: number;          // Default: 40_000
  minTrimSavings?: number;          // Default: 20_000
  protectLastUserMessages?: number; // Default: 3
}

function compactContext(options: CompactContextOptions): ModelMessage[];
```

## Algorithm

```
1. Get current token usage from the last step's promptTokens
2. If currentTokens <= tokenThreshold, return messages unchanged
3. Find the cutoff index: the index of the Nth user message from the end
   - All messages at and after this index are protected
   - Only messages BEFORE this index are candidates for trimming
4. Estimate tokens in tool-related content before the cutoff
5. If toolTokensBeforeCutoff < minTrimSavings, return messages unchanged
6. Use pruneMessages to remove tool calls before the calculated message boundary
7. Return pruned messages
```

## Implementation Details

### Getting Current Token Usage

The most recent step's `inputTokens` tells us the current context size:

```typescript
function getCurrentTokenUsage(steps: StepResult[]): number {
  if (steps.length === 0) return 0;
  const lastStep = steps[steps.length - 1];
  return lastStep.usage?.inputTokens ?? 0;
}
```

### Find Cutoff Index

Find the index where the protection window starts (the Nth user message from the end):

```typescript
function findCutoffIndex(
  messages: ModelMessage[],
  protectLastUserMessages: number
): number {
  let userMessageCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userMessageCount++;
      if (userMessageCount >= protectLastUserMessages) {
        return i; // This index and everything after is protected
      }
    }
  }
  return 0; // Protect all messages if fewer than N user messages exist
}
```

### Estimate Tool Tokens Before Cutoff

For the savings estimate, we approximate how many tokens are in tool calls before the protection window:

```typescript
function estimateToolTokensBeforeCutoff(
  messages: ModelMessage[],
  cutoffIndex: number
): number {
  let toolChars = 0;
  for (let i = 0; i < cutoffIndex; i++) {
    const message = messages[i];
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'tool-call' || part.type === 'tool-result') {
          toolChars += JSON.stringify(part).length;
        }
      }
    }
  }
  return Math.ceil(toolChars / 4);
}
```

### Prune Using AI SDK

Use `pruneMessages` from the AI SDK. Calculate how many messages (from the end) should be protected:

```typescript
import { pruneMessages } from 'ai';

// Messages to protect = total messages - cutoff index
const messagesToProtect = messages.length - cutoffIndex;

return pruneMessages({
  messages,
  toolCalls: `before-last-${messagesToProtect}-messages`,
  emptyMessages: 'remove',
});
```

## Complete Implementation

**File**: `src/agent/utils/compact-context.ts`

```typescript
import { pruneMessages, type ModelMessage, type StepResult } from "ai";

export interface CompactContextOptions {
  messages: ModelMessage[];
  steps: StepResult<any, any>[];
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
 */
export function compactContext({
  messages,
  steps,
  tokenThreshold = 40_000,
  minTrimSavings = 20_000,
  protectLastUserMessages = 3,
}: CompactContextOptions): ModelMessage[] {
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
  const toolTokensToTrim = estimateToolTokensBeforeCutoff(messages, cutoffIndex);
  if (toolTokensToTrim < minTrimSavings) {
    return messages; // Not enough savings to justify trimming
  }

  // Step 4: Calculate messages to protect and prune
  const messagesToProtect = messages.length - cutoffIndex;

  return pruneMessages({
    messages,
    toolCalls: `before-last-${messagesToProtect}-messages`,
    emptyMessages: "remove",
  });
}

function getCurrentTokenUsage(steps: StepResult<any, any>[]): number {
  if (steps.length === 0) return 0;
  const lastStep = steps[steps.length - 1];
  return lastStep.usage?.inputTokens ?? 0;
}

function findCutoffIndex(
  messages: ModelMessage[],
  protectLastUserMessages: number
): number {
  let userMessageCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
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
  cutoffIndex: number
): number {
  let toolChars = 0;
  for (let i = 0; i < cutoffIndex; i++) {
    const message = messages[i];
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          part.type === "tool-call" ||
          part.type === "tool-result"
        ) {
          toolChars += JSON.stringify(part).length;
        }
      }
    }
  }
  return Math.ceil(toolChars / 4);
}
```

## Integration

**File**: `src/agent/utils/index.ts`

Add export:
```typescript
export { compactContext } from "./compact-context";
```

**File**: `src/agent/deep-agent.ts`

Update prepareStep:
```typescript
import { addCacheControl, compactContext } from "./utils";

// ...

prepareStep: ({ messages, model, steps }) => ({
  messages: addCacheControl({
    messages: compactContext({ messages, steps }),
    model,
  }),
}),
```

## Testing Scenarios

1. **Below threshold**: 30k tokens should return unchanged
2. **Low savings**: 50k tokens but only 10k in old tool calls should return unchanged
3. **Compaction triggered**: 60k tokens and 30k in old tool calls should be pruned
4. **Protection window respected**: All messages within last 3 user message boundaries remain untouched
5. **Empty messages**: Verify empty messages after pruning are removed
6. **Edge cases**: First few steps (< 3 user messages) should not compact

## Future Enhancements

1. **Per-step token tracking**: Track tool call tokens per step for more accurate savings calculation
2. **Configurable per model**: Use `getContextLimit()` to set thresholds based on model
3. **Preserve important tool calls**: Option to protect specific tool types
4. **Logging**: Add optional logging when compaction occurs for debugging
