# Context Management

Prevents context window overflow by reducing message history when approaching the model's context limit.

## When to Trigger

**80% of model's context window** (e.g., ~160K tokens for a 200K model)

## Strategies

Pick one:

| Strategy | How it works | Trade-offs |
|----------|--------------|------------|
| **Pruning** | Remove old tool calls/results using AI SDK's `pruneMessages()` | Fast, deterministic, no LLM cost. Loses tool details but keeps conversation structure. |
| **Summarization** | LLM generates a summary, replaces old messages | Preserves semantic meaning. Costs money, adds latency, may lose nuance. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         prepareStep()                            │
│                  (called before each inference)                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. RECONSTRUCT CHECK (summarization strategy only)              │
│     └─ Is there a summary tool-result in messages?               │
│        YES → Rebuild as [system msgs] + [summary] + [after]      │
│              Return early                                        │
│        NO  → Continue                                            │
│                                                                  │
│  2. THRESHOLD CHECK                                              │
│     └─ currentTokens >= (contextLimit × 0.8)?                    │
│        NO  → Return messages unchanged                           │
│        YES → Apply strategy                                      │
│                                                                  │
│  3. APPLY STRATEGY                                               │
│                                                                  │
│     ┌─ PRUNING ─────────────────────────────────────────┐        │
│     │  • Call pruneMessages({ toolCalls: "before-N" })  │        │
│     │  • Return pruned messages                         │        │
│     │  • Done (synchronous)                             │        │
│     └───────────────────────────────────────────────────┘        │
│                                                                  │
│     ┌─ SUMMARIZATION ───────────────────────────────────┐        │
│     │  • Return { toolChoice: "summarizeThread" }       │        │
│     │  • Model forced to call summarization tool        │        │
│     │  • Tool invokes summarizer subagent (Haiku)       │        │
│     │  • Summary stored as tool-result in messages      │        │
│     │  • Next prepareStep hits reconstruct check (1)    │        │
│     └───────────────────────────────────────────────────┘        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Configuration

```typescript
type CompactionStrategy = "none" | "pruning" | "summarization";

interface CompactionConfig {
  strategy: CompactionStrategy;
  thresholdPercent: number; // 0.8 = 80% of context limit
}
```

Pass config through `experimental_context` to avoid global state:

```typescript
prepareCall: ({ options, ...settings }) => {
  const compaction: CompactionConfig = {
    strategy: options?.compactionStrategy ?? "pruning",
    thresholdPercent: options?.compactionThresholdPercent ?? 0.8,
  };

  return {
    ...settings,
    experimental_context: {
      // ...other context
      compaction,
    },
  };
},
```

## Implementation

### Pruning

Uses AI SDK's `pruneMessages()` to remove old tool calls while protecting recent messages.

```typescript
import { pruneMessages } from "ai";

function pruneOldToolCalls(
  messages: ModelMessage[],
  protectLastUserMessages = 3,
): ModelMessage[] {
  // Find where protected window starts (Nth-to-last user message)
  const cutoffIndex = findProtectedWindowStart(messages, protectLastUserMessages);
  const messagesToProtect = messages.length - cutoffIndex;

  return pruneMessages({
    messages,
    toolCalls: messagesToProtect === 0
      ? "all"
      : `before-last-${messagesToProtect}-messages`,
    emptyMessages: "remove",
  });
}
```

### Summarization

Two parts: a tool that gets force-called, and reconstruction logic.

**Tool definition:**

```typescript
const summarizeThreadTool = tool({
  description: "Summarize conversation to reduce context size",
  inputSchema: z.object({}),
  execute: async (_, { messages, abortSignal }) => {
    const conversationMessages = messages.filter(m => m.role !== "system");
    const historyText = formatForSummary(conversationMessages);

    // Call Haiku subagent for cost-effective summarization
    const result = await summarizerSubagent.generate({
      prompt: historyText,
      abortSignal,
    });

    return {
      summary: result.text,
      summarizedAt: Date.now(),
      messageCount: conversationMessages.length,
    };
  },
});
```

**Reconstruction:**

After the tool runs, the summary is in messages as a tool-result. On the next `prepareStep`, reconstruct the conversation:

```typescript
function reconstructFromSummary(messages: ModelMessage[]): ModelMessage[] | null {
  const summaryResult = findSummaryToolResult(messages);
  if (!summaryResult) return null;

  const { summary, index } = summaryResult;
  const systemMessages = messages.filter(m => m.role === "system");
  const afterSummary = messages.slice(index + 1);

  return [
    ...systemMessages,
    { role: "user", content: `[Previous conversation summary]\n\n${summary}` },
    ...afterSummary,
  ];
}
```

## prepareStep Integration

```typescript
prepareStep: ({ messages, steps, model, experimental_context }) => {
  const { compaction } = experimental_context;

  if (compaction.strategy === "none") {
    return { messages };
  }

  // Get current token usage and threshold
  const contextLimit = getContextLimit(model);
  const threshold = contextLimit * compaction.thresholdPercent;
  const currentTokens = steps.at(-1)?.usage?.inputTokens ?? 0;

  // 1. Summarization: check for existing summary to reconstruct
  if (compaction.strategy === "summarization") {
    const reconstructed = reconstructFromSummary(messages);
    if (reconstructed) {
      return { messages: reconstructed };
    }
  }

  // 2. Under threshold: no action needed
  if (currentTokens < threshold) {
    return { messages };
  }

  // 3. Over threshold: apply strategy
  if (compaction.strategy === "pruning") {
    return { messages: pruneOldToolCalls(messages) };
  }

  if (compaction.strategy === "summarization") {
    return {
      messages,
      toolChoice: { type: "tool", toolName: "summarizeThread" },
      activeTools: ["summarizeThread"],
    };
  }

  return { messages };
},
```

## File Structure

```
src/agent/context-management/
├── index.ts              # exports
├── prune.ts              # pruneOldToolCalls()
├── reconstruct.ts        # reconstructFromSummary() (summarization only)
├── model-limits.ts       # getContextLimit()
└── cache-control.ts      # addCacheControl()

src/agent/tools/
└── summarize-thread.ts   # (summarization only)

src/agent/subagents/
└── summarizer.ts         # (summarization only)
```

## Model Context Limits

```typescript
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-haiku-4-20250414": 200_000,
};

const DEFAULT_CONTEXT_LIMIT = 200_000;

function getContextLimit(model: LanguageModel): number {
  return MODEL_CONTEXT_LIMITS[model.modelId] ?? DEFAULT_CONTEXT_LIMIT;
}
```
