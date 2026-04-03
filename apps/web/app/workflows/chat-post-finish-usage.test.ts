import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LanguageModelUsage } from "ai";
import type { WebAgentUIMessage } from "@/app/types";

function makeUsage(
  partial: Partial<LanguageModelUsage> &
    Pick<LanguageModelUsage, "inputTokens" | "outputTokens" | "totalTokens">,
): LanguageModelUsage {
  return {
    cachedInputTokens: 0,
    reasoningTokens: 0,
    inputTokenDetails: undefined,
    outputTokenDetails: undefined,
    ...partial,
  } as LanguageModelUsage;
}

function makeAssistantMessage(
  overrides?: Partial<WebAgentUIMessage>,
): WebAgentUIMessage {
  return {
    id: "msg-2",
    role: "assistant",
    parts: [{ type: "text", text: "Response" }],
    ...overrides,
  } as WebAgentUIMessage;
}

const spies = {
  recordUsage: mock(() => Promise.resolve()),
  collectTaskToolUsageEvents: mock(
    (_message?: unknown) =>
      [] as Array<{
        modelId?: string;
        toolCallId?: string;
        usage: LanguageModelUsage;
      }>,
  ),
  sumLanguageModelUsage: mock(
    (a: LanguageModelUsage | undefined, b: LanguageModelUsage) => ({
      inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
      outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    }),
  ),
};

mock.module("@/lib/db/sessions", () => ({
  compareAndSetChatActiveStreamId: mock(() => Promise.resolve(true)),
  createChatMessageIfNotExists: mock(() => Promise.resolve(undefined)),
  touchChat: mock(() => Promise.resolve()),
  updateChat: mock(() => Promise.resolve()),
  updateSession: mock(() => Promise.resolve()),
  isFirstChatMessage: mock(() => Promise.resolve(false)),
  upsertChatMessageScoped: mock(() => Promise.resolve({ status: "inserted" })),
  updateChatAssistantActivity: mock(() => Promise.resolve()),
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: mock(() => ({})),
  buildLifecycleActivityUpdate: mock(() => ({})),
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage: spies.recordUsage,
}));

mock.module("@open-harness/agent", () => ({
  collectTaskToolUsageEvents: spies.collectTaskToolUsageEvents,
  sumLanguageModelUsage: spies.sumLanguageModelUsage,
}));

const { recordWorkflowUsage } = await import("./chat-post-finish");

beforeEach(() => {
  Object.values(spies).forEach((spy) => spy.mockClear());
});

describe("recordWorkflowUsage", () => {
  test("records main agent usage", async () => {
    const usage = makeUsage({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedInputTokens: 10,
    });

    await recordWorkflowUsage("user-1", "gpt-4", usage, makeAssistantMessage());

    expect(spies.recordUsage).toHaveBeenCalledTimes(1);
    const calls = spies.recordUsage.mock.calls as unknown[][];
    expect(calls[0][0]).toBe("user-1");
    expect(calls[0][1]).toMatchObject({
      source: "web",
      agentType: "main",
      model: "gpt-4",
    });
  });

  test("skips main recording when totalUsage is undefined", async () => {
    await recordWorkflowUsage(
      "user-1",
      "gpt-4",
      undefined,
      makeAssistantMessage(),
    );

    expect(spies.recordUsage).not.toHaveBeenCalled();
  });

  test("records subagent usage grouped by model", async () => {
    const subEvents = [
      {
        modelId: "claude-3",
        toolCallId: "task-1",
        usage: makeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      },
      {
        modelId: "claude-3",
        toolCallId: "task-2",
        usage: makeUsage({
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        }),
      },
      {
        modelId: "gpt-4",
        toolCallId: "task-3",
        usage: makeUsage({
          inputTokens: 30,
          outputTokens: 15,
          totalTokens: 45,
        }),
      },
    ];
    spies.collectTaskToolUsageEvents.mockReturnValueOnce(subEvents);

    const usage = makeUsage({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });

    await recordWorkflowUsage("user-1", "gpt-4", usage, makeAssistantMessage());

    expect(spies.recordUsage).toHaveBeenCalledTimes(3);

    const calls = spies.recordUsage.mock.calls as unknown[][];
    const subCalls = calls.filter(
      (c) => (c[1] as { agentType: string }).agentType === "subagent",
    );
    expect(subCalls).toHaveLength(2);

    const models = subCalls.map((c) => (c[1] as { model: string }).model);
    expect(models.toSorted()).toEqual(["claude-3", "gpt-4"]);

    const claudeCall = subCalls.find(
      (c) => (c[1] as { model: string }).model === "claude-3",
    );
    const gptCall = subCalls.find(
      (c) => (c[1] as { model: string }).model === "gpt-4",
    );

    expect(claudeCall?.[1]).toMatchObject({
      toolCallCount: 2,
      usage: {
        inputTokens: 30,
        outputTokens: 15,
      },
    });
    expect(gptCall?.[1]).toMatchObject({
      toolCallCount: 1,
      usage: {
        inputTokens: 30,
        outputTokens: 15,
      },
    });
  });

  test("records only new subagent usage when continuing an existing assistant message", async () => {
    const previousMessage = makeAssistantMessage({ id: "msg-prev" });
    const responseMessage = makeAssistantMessage({ id: "msg-next" });

    const existingEvent = {
      modelId: "claude-3",
      toolCallId: "task-existing",
      usage: makeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    };
    const newEvent = {
      modelId: "claude-3",
      toolCallId: "task-new",
      usage: makeUsage({ inputTokens: 7, outputTokens: 3, totalTokens: 10 }),
    };

    spies.collectTaskToolUsageEvents.mockImplementation((message?: unknown) => {
      const messageId = (message as { id?: string } | undefined)?.id;

      if (messageId === "msg-prev") {
        return [existingEvent];
      }

      if (messageId === "msg-next") {
        return [existingEvent, newEvent];
      }

      return [];
    });

    await recordWorkflowUsage(
      "user-1",
      "gpt-4",
      undefined,
      responseMessage,
      previousMessage,
    );

    expect(spies.recordUsage).toHaveBeenCalledTimes(1);
    const calls = spies.recordUsage.mock.calls as unknown[][];
    expect(calls[0][1]).toMatchObject({
      source: "web",
      agentType: "subagent",
      model: "claude-3",
      toolCallCount: 1,
      usage: {
        inputTokens: 7,
        outputTokens: 3,
      },
    });
  });

  test("falls back to main modelId when event has no modelId", async () => {
    spies.collectTaskToolUsageEvents.mockReturnValueOnce([
      {
        modelId: undefined,
        usage: makeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      },
    ]);

    await recordWorkflowUsage(
      "user-1",
      "gpt-4",
      undefined,
      makeAssistantMessage(),
    );

    expect(spies.recordUsage).toHaveBeenCalledTimes(1);
    const calls = spies.recordUsage.mock.calls as unknown[][];
    expect((calls[0][1] as { model: string }).model).toBe("gpt-4");
  });

  test("does not throw on error", async () => {
    spies.recordUsage.mockImplementationOnce(() =>
      Promise.reject(new Error("Usage DB down")),
    );

    const usage = makeUsage({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });

    await recordWorkflowUsage("user-1", "gpt-4", usage, makeAssistantMessage());
  });
});
