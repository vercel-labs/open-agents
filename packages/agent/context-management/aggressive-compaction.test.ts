import { describe, expect, test } from "bun:test";
import type { ModelMessage, StepResult, ToolSet } from "ai";
import { aggressiveCompactContext } from "./aggressive-compaction";

const COMPACTED_NOTICE =
  "This tool payload was compacted to save context. Please run the tool again if needed.";

type ToolCallSnapshot = { id: string; input: unknown };
type ToolResultSnapshot = { id: string; output: unknown };

function createSteps(inputTokens: number): StepResult<ToolSet>[] {
  return [
    {
      usage: {
        inputTokens,
      },
    } as unknown as StepResult<ToolSet>,
  ];
}

function createConversation(
  toolCallCount: number,
  payloadSize: number,
): {
  messages: ModelMessage[];
  payload: string;
} {
  const payload = "x".repeat(payloadSize);

  const assistantContent = [
    { type: "text", text: "Working on it" },
    ...Array.from({ length: toolCallCount }, (_, index) => ({
      type: "tool-call",
      toolCallId: `call-${index}`,
      toolName: "read",
      input: { filePath: `/tmp/file-${index}.txt`, payload },
    })),
  ];

  const toolContent = Array.from({ length: toolCallCount }, (_, index) => ({
    type: "tool-result",
    toolCallId: `call-${index}`,
    toolName: "read",
    output: { value: payload },
  }));

  return {
    payload,
    messages: [
      { role: "user", content: "Please inspect the files." },
      {
        role: "assistant",
        content: assistantContent,
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: toolContent,
      } as unknown as ModelMessage,
    ],
  };
}

function appendToolExchange(
  messages: ModelMessage[],
  callId: number,
  payload: string,
): ModelMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    if (message.role === "assistant") {
      return {
        ...message,
        content: [
          ...message.content,
          {
            type: "tool-call",
            toolCallId: `call-${callId}`,
            toolName: "read",
            input: { filePath: `/tmp/file-${callId}.txt`, payload },
          },
        ],
      } as ModelMessage;
    }

    if (message.role === "tool") {
      return {
        ...message,
        content: [
          ...message.content,
          {
            type: "tool-result",
            toolCallId: `call-${callId}`,
            toolName: "read",
            output: { value: payload },
          },
        ],
      } as ModelMessage;
    }

    return message;
  });
}

function getToolCalls(messages: ModelMessage[]): ToolCallSnapshot[] {
  const calls: ToolCallSnapshot[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part &&
        "type" in part &&
        part.type === "tool-call" &&
        "toolCallId" in part &&
        typeof part.toolCallId === "string"
      ) {
        calls.push({
          id: part.toolCallId,
          input: "input" in part ? part.input : undefined,
        });
      }
    }
  }

  return calls;
}

function getToolResults(messages: ModelMessage[]): ToolResultSnapshot[] {
  const results: ToolResultSnapshot[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part &&
        "type" in part &&
        part.type === "tool-result" &&
        "toolCallId" in part &&
        typeof part.toolCallId === "string"
      ) {
        results.push({
          id: part.toolCallId,
          output: "output" in part ? part.output : undefined,
        });
      }
    }
  }

  return results;
}

describe("aggressiveCompactContext", () => {
  test("compacts older tool calls/results while retaining the latest 20 calls", () => {
    const { messages, payload } = createConversation(80, 1200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(50_000),
      contextLimit: 100_000,
    });

    const compactedCalls = getToolCalls(compacted);
    const compactedResults = getToolResults(compacted);

    expect(compactedCalls).toHaveLength(80);
    expect(compactedResults).toHaveLength(80);

    for (let index = 0; index < 60; index++) {
      const call = compactedCalls[index];
      const result = compactedResults[index];

      expect(call?.id).toBe(`call-${index}`);
      expect(call?.input).toEqual({
        compacted: true,
        message: COMPACTED_NOTICE,
      });

      expect(result?.id).toBe(`call-${index}`);
      expect(result?.output).toEqual({
        type: "text",
        value: COMPACTED_NOTICE,
      });
    }

    for (let index = 60; index < 80; index++) {
      const call = compactedCalls[index];
      const result = compactedResults[index];

      expect(call?.id).toBe(`call-${index}`);
      expect(call?.input).toEqual({
        filePath: `/tmp/file-${index}.txt`,
        payload,
      });

      expect(result?.id).toBe(`call-${index}`);
      expect(result?.output).toEqual({ value: payload });
    }
  });

  test("does not compact when input tokens are below threshold", () => {
    const { messages } = createConversation(80, 1200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(39_000),
      contextLimit: 100_000,
    });

    expect(compacted).toBe(messages);
  });

  test("uses provided lastInputTokens when available", () => {
    const { messages } = createConversation(80, 1200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(5_000),
      contextLimit: 100_000,
      lastInputTokens: 50_000,
    });

    expect(compacted).not.toBe(messages);
  });

  test("estimates token usage from messages when step usage is unavailable", () => {
    const { messages } = createConversation(80, 1200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: [],
      contextLimit: 100_000,
    });

    expect(compacted).not.toBe(messages);
  });

  test("applies trigger and savings percentages against context limit", () => {
    const { messages } = createConversation(80, 1200);

    const defaultThresholdCompacted = aggressiveCompactContext({
      messages,
      steps: createSteps(50_000),
      contextLimit: 200_000,
    });

    expect(defaultThresholdCompacted).toBe(messages);

    const customPercentageCompacted = aggressiveCompactContext({
      messages,
      steps: createSteps(50_000),
      contextLimit: 200_000,
      triggerPercent: 0.2,
      minSavingsPercent: 0.1,
    });

    expect(customPercentageCompacted).not.toBe(messages);
  });

  test("does not compact when estimated savings are below min threshold", () => {
    const { messages } = createConversation(25, 200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(50_000),
      contextLimit: 100_000,
      retainRecentToolCalls: 20,
    });

    expect(compacted).toBe(messages);
  });

  test("waits for a checkpoint batch before compacting newly eligible tool calls", () => {
    const { messages, payload } = createConversation(60, 1200);

    const initialCompacted = aggressiveCompactContext({
      messages,
      steps: createSteps(70_000),
      contextLimit: 100_000,
      retainRecentToolCalls: 20,
      checkpointToolCalls: 1,
      forceCompactionPercent: 0.95,
    });

    const withNewToolCall = appendToolExchange(initialCompacted, 60, payload);

    const deferred = aggressiveCompactContext({
      messages: withNewToolCall,
      steps: createSteps(70_000),
      contextLimit: 100_000,
      retainRecentToolCalls: 20,
      checkpointToolCalls: 8,
      forceCompactionPercent: 0.95,
    });

    expect(deferred).toBe(withNewToolCall);

    const newlyEligibleCall = getToolCalls(deferred).find(
      (call) => call.id === "call-40",
    );

    expect(newlyEligibleCall?.input).toEqual({
      filePath: "/tmp/file-40.txt",
      payload,
    });
  });

  test("forces compaction near the context limit even below checkpoint size", () => {
    const { messages, payload } = createConversation(60, 1200);

    const initialCompacted = aggressiveCompactContext({
      messages,
      steps: createSteps(70_000),
      contextLimit: 100_000,
      retainRecentToolCalls: 20,
      checkpointToolCalls: 1,
      forceCompactionPercent: 0.95,
    });

    const withNewToolCall = appendToolExchange(initialCompacted, 60, payload);

    const forced = aggressiveCompactContext({
      messages: withNewToolCall,
      steps: createSteps(82_000),
      contextLimit: 100_000,
      retainRecentToolCalls: 20,
      checkpointToolCalls: 8,
      forceCompactionPercent: 0.8,
    });

    expect(forced).not.toBe(withNewToolCall);

    const newlyEligibleCall = getToolCalls(forced).find(
      (call) => call.id === "call-40",
    );

    expect(newlyEligibleCall?.input).toEqual({
      compacted: true,
      message: COMPACTED_NOTICE,
    });
  });
});
