import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

let upsertResult: { status: "inserted" | "updated" | "conflict" } = {
  status: "inserted",
};

const upsertSpy = mock(() => Promise.resolve(upsertResult));

mock.module("ai", () => ({
  isToolUIPart: (part: { type: string }) =>
    part.type.startsWith("tool-") || part.type === "dynamic-tool",
}));

mock.module("@/lib/db/sessions", () => ({
  upsertChatMessageScoped: upsertSpy,
}));

const { persistAssistantMessagesWithToolResults } =
  await import("./persist-tool-results");

function assistantWithToolResult(
  overrides?: Partial<WebAgentUIMessage>,
): WebAgentUIMessage[] {
  return [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me ask you a question." },
        {
          type: "tool-ask_user_question",
          toolCallId: "call-1",
          toolName: "ask_user_question",
          state: "output-available",
          args: { questions: [] },
          output: { answers: { "0": "Yes" } },
        },
      ],
      ...overrides,
    } as WebAgentUIMessage,
  ];
}

describe("persistAssistantMessagesWithToolResults", () => {
  beforeEach(() => {
    upsertResult = { status: "inserted" };
    upsertSpy.mockClear();
  });

  test("persists assistant message with tool results", async () => {
    await persistAssistantMessagesWithToolResults(
      "chat-1",
      assistantWithToolResult(),
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const calls = upsertSpy.mock.calls as unknown[][];
    expect(calls[0]![0]).toMatchObject({
      id: "assistant-1",
      chatId: "chat-1",
      role: "assistant",
    });
  });

  test("skips when latest message is not assistant", async () => {
    await persistAssistantMessagesWithToolResults("chat-1", [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      } as WebAgentUIMessage,
    ]);

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  test("skips when assistant message has no tool results", async () => {
    await persistAssistantMessagesWithToolResults("chat-1", [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Just text." }],
      } as WebAgentUIMessage,
    ]);

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  test("skips when messages array is empty", async () => {
    await persistAssistantMessagesWithToolResults("chat-1", []);

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  test("logs warning on conflict", async () => {
    upsertResult = { status: "conflict" };

    await persistAssistantMessagesWithToolResults(
      "chat-1",
      assistantWithToolResult(),
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  test("does not throw on db error", async () => {
    upsertSpy.mockImplementationOnce(() =>
      Promise.reject(new Error("DB down")),
    );

    await persistAssistantMessagesWithToolResults(
      "chat-1",
      assistantWithToolResult(),
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });
});
