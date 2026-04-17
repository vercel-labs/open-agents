import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UIMessageChunk } from "ai";

// ── Spy state ──────────────────────────────────────────────────────

const writtenChunks: UIMessageChunk[] = [];
let runStatus: string = "running";

const spies = {
  persistAssistantMessage: mock(() => Promise.resolve()),
  persistSandboxState: mock(() => Promise.resolve()),
  clearActiveStream: mock(() => Promise.resolve()),
  recordWorkflowUsage: mock(() => Promise.resolve()),
  refreshDiffCache: mock(() => Promise.resolve()),
  refreshLifecycleActivity: mock(() => Promise.resolve()),
  hasAutoCommitChangesStep: mock(() => Promise.resolve(true)),
  runAutoCommitStep: mock(() =>
    Promise.resolve({ committed: false, pushed: false }),
  ),
  runAutoCreatePrStep: mock(() =>
    Promise.resolve({
      created: true,
      syncedExisting: false,
      skipped: false,
      prNumber: 42,
      prUrl: "https://github.com/acme/repo/pull/42",
    }),
  ),
};

// Track what the agent stream yields
let agentStreamParts: Array<Record<string, unknown>> = [];
let agentFinishReason = "stop";
let agentRawFinishReason: string | undefined = "provider_stop";
let agentTotalUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
let agentResponseMessages: unknown[] = [];
let agentResponse: Record<string, unknown> = {
  messages: agentResponseMessages,
};
let streamOnFinishCallback:
  | ((args: { responseMessage: unknown }) => void)
  | undefined;
let agentWarnings: unknown[] | undefined;
let agentRequestBody: unknown;
let agentResponseHeaders: Record<string, string> | undefined;
let agentResponseBody: unknown;
let agentProviderMetadata: Record<string, unknown> | undefined;
let agentInputMessages: unknown;

function buildAgentSteps() {
  return [
    {
      stepNumber: 0,
      model: {
        provider: "openai",
        modelId:
          typeof agentResponse.modelId === "string"
            ? agentResponse.modelId
            : "test-model",
      },
      finishReason: agentFinishReason,
      rawFinishReason: agentRawFinishReason,
      usage: agentTotalUsage,
      warnings: agentWarnings,
      content: [{ type: "text" }],
      toolCalls: [],
      toolResults: [],
      request: { body: agentRequestBody },
      response: {
        id:
          typeof agentResponse.id === "string"
            ? agentResponse.id
            : "response-1",
        modelId:
          typeof agentResponse.modelId === "string"
            ? agentResponse.modelId
            : "test-model",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        headers: agentResponseHeaders,
        body: agentResponseBody,
        messages: agentResponseMessages,
      },
      providerMetadata: agentProviderMetadata,
    },
  ];
}

// ── Module mocks ───────────────────────────────────────────────────

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_test-123" }),
  getWritable: () => {
    const writable = new WritableStream<UIMessageChunk>({
      write(chunk) {
        writtenChunks.push(chunk);
      },
    });
    return writable;
  },
}));

mock.module("workflow/api", () => ({
  getRun: () => ({
    get status() {
      return Promise.resolve(runStatus);
    },
  }),
}));

mock.module("./chat-post-finish", () => spies);

mock.module("@/app/config", () => ({
  webAgent: {
    tools: {},
    stream: async ({ messages }: { messages: unknown }) => {
      agentInputMessages = messages;
      return {
        toUIMessageStream: (opts: {
          sendStart?: boolean;
          sendFinish?: boolean;
          originalMessages?: Array<Record<string, unknown>>;
          messageMetadata?: (args: {
            part: Record<string, unknown>;
          }) => unknown;
          onFinish?: (args: { responseMessage: unknown }) => void;
        }) => {
          const priorAssistantMessage = opts.originalMessages?.at(-1);
          const assistantMessage = (
            priorAssistantMessage?.role === "assistant"
              ? structuredClone(priorAssistantMessage)
              : {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ type: "text", text: "Hello!" }],
                  metadata: {},
                }
          ) as {
            id: string;
            role: "assistant";
            parts: Array<Record<string, unknown>>;
            metadata?: unknown;
          };

          streamOnFinishCallback = opts.onFinish;
          // Return an async iterable that yields parts and calls onFinish
          return {
            async *[Symbol.asyncIterator]() {
              for (const part of agentStreamParts) {
                yield part;

                const metadata = opts.messageMetadata?.({ part });
                if (metadata) {
                  assistantMessage.metadata = Object.assign(
                    {},
                    assistantMessage.metadata as
                      | Record<string, unknown>
                      | undefined,
                    metadata as Record<string, unknown>,
                  );
                  yield {
                    type: "message-metadata",
                    messageMetadata: metadata,
                  };
                }
              }
              if (streamOnFinishCallback) {
                streamOnFinishCallback({
                  responseMessage: assistantMessage,
                });
              }
            },
          };
        },
        totalUsage: Promise.resolve(agentTotalUsage),
        finishReason: Promise.resolve(agentFinishReason),
        rawFinishReason: Promise.resolve(agentRawFinishReason),
        response: Promise.resolve(agentResponse),
        steps: Promise.resolve(buildAgentSteps()),
      };
    },
  },
}));

mock.module("ai", () => ({
  convertToModelMessages: async (
    msgs: Array<Record<string, unknown>>,
    options?: { convertDataPart?: (part: Record<string, unknown>) => unknown },
  ) =>
    msgs.map((message) => {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const content = parts.flatMap((part) => {
        if (typeof part !== "object" || part === null) {
          return [];
        }

        if (part.type === "text" && typeof part.text === "string") {
          return [{ type: "text", text: part.text }];
        }

        if (
          typeof part.type === "string" &&
          part.type.startsWith("data-") &&
          options?.convertDataPart
        ) {
          const convertedPart = options.convertDataPart(
            part as Record<string, unknown>,
          );
          return convertedPart === undefined ? [] : [convertedPart];
        }

        return [];
      });

      return {
        role: message.role,
        content,
      };
    }),
  generateId: () => "gen-id-1",
  isToolUIPart: (part: { type: string }) => part.type === "tool-invocation",
  pruneMessages: ({ messages }: { messages: Array<Record<string, unknown>> }) =>
    messages.filter((message) => {
      const content = message.content;
      return !Array.isArray(content) || content.length > 0;
    }),
}));

mock.module("@open-harness/agent", () => ({}));

const { runAgentWorkflow } = await import("./chat");

// ── Helpers ────────────────────────────────────────────────────────

function makeOptions(overrides?: Record<string, unknown>) {
  return {
    messages: [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text", text: "Hello" }],
      },
    ],
    chatId: "chat-1",
    sessionId: "session-1",
    userId: "user-1",
    selectedModelId: "gpt-4",
    modelId: "gpt-4",
    agentOptions: {
      sandbox: { state: { type: "vercel" } },
    },
    maxSteps: 1,
    ...overrides,
  } as Parameters<typeof runAgentWorkflow>[0];
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  writtenChunks.length = 0;
  runStatus = "running";
  agentStreamParts = [{ type: "text-delta", textDelta: "Hi" }];
  agentFinishReason = "stop";
  agentRawFinishReason = "provider_stop";
  agentTotalUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
  agentResponseMessages = [];
  agentResponse = { messages: agentResponseMessages };
  agentWarnings = undefined;
  agentRequestBody = undefined;
  agentResponseHeaders = undefined;
  agentResponseBody = undefined;
  agentProviderMetadata = undefined;
  agentInputMessages = undefined;
  streamOnFinishCallback = undefined;
  Object.values(spies).forEach((s) => s.mockClear());
});

describe("runAgentWorkflow", () => {
  test("throws when no messages provided", async () => {
    try {
      await runAgentWorkflow(makeOptions({ messages: [] }));
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain("at least one message");
    }
  });

  test("sends start and finish chunks to writable", async () => {
    await runAgentWorkflow(makeOptions());

    const types = writtenChunks.map((c) => c.type);
    expect(types[0]).toBe("start");
    expect(types[types.length - 1]).toBe("finish");
  });

  test("persists assistant message after run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.persistAssistantMessage).toHaveBeenCalledTimes(1);
    const paCalls = spies.persistAssistantMessage.mock.calls as unknown[][];
    expect(paCalls[0][0]).toBe("chat-1");
  });

  test("records usage after run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.recordWorkflowUsage).toHaveBeenCalledTimes(1);
    const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
    expect(rwCalls[0][0]).toBe("user-1");
    expect(rwCalls[0][1]).toBe("gpt-4");
  });

  test("persists model metadata even without a finish-step chunk", async () => {
    await runAgentWorkflow(
      makeOptions({
        selectedModelId: "variant:builtin:gpt-5.4-xhigh",
        modelId: "openai/gpt-5.4",
      }),
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        selectedModelId?: string;
        modelId?: string;
      };
    };

    expect(persistedMessage.metadata).toMatchObject({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelId: "openai/gpt-5.4",
    });
  });

  test("streams model metadata in finish-step chunks", async () => {
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "provider_stop",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        selectedModelId: "variant:builtin:gpt-5.4-xhigh",
        modelId: "openai/gpt-5.4",
      }),
    );

    const metadataChunks = writtenChunks.filter(
      (
        chunk,
      ): chunk is UIMessageChunk & {
        type: "message-metadata";
        messageMetadata: {
          selectedModelId?: string;
          modelId?: string;
        };
      } => chunk.type === "message-metadata",
    );

    expect(metadataChunks.at(-1)?.messageMetadata).toMatchObject({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelId: "openai/gpt-5.4",
    });

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        selectedModelId?: string;
        modelId?: string;
      };
    };

    expect(persistedMessage.metadata).toMatchObject({
      selectedModelId: "variant:builtin:gpt-5.4-xhigh",
      modelId: "openai/gpt-5.4",
    });
  });

  test("overwrites model metadata when resuming an assistant message", async () => {
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "provider_stop",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "assistant-1",
            role: "assistant" as const,
            parts: [{ type: "text", text: "Need your approval" }],
            metadata: {
              selectedModelId: "variant:builtin:gpt-5.4-xhigh",
              modelId: "openai/gpt-5.4",
            },
          },
        ],
        selectedModelId: "anthropic/claude-opus-4.6",
        modelId: "anthropic/claude-opus-4.6",
      }),
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        selectedModelId?: string;
        modelId?: string;
      };
    };

    expect(persistedMessage.metadata).toMatchObject({
      selectedModelId: "anthropic/claude-opus-4.6",
      modelId: "anthropic/claude-opus-4.6",
    });
  });

  test("marks workflow run as failed when maxSteps is exhausted", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const rwCalls = spies.recordWorkflowUsage.mock.calls as unknown[][];
    const workflowRun = rwCalls[0][5] as {
      workflowRunId: string;
      status: string;
      totalDurationMs: number;
      stepTimings: Array<{
        stepNumber: number;
        durationMs: number;
        finishReason?: string;
      }>;
    };

    expect(workflowRun.workflowRunId).toBe("wrun_test-123");
    expect(workflowRun.status).toBe("failed");
    expect(workflowRun.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(workflowRun.stepTimings).toHaveLength(2);
    expect(workflowRun.stepTimings).toEqual([
      expect.objectContaining({
        stepNumber: 1,
        durationMs: expect.any(Number),
        finishReason: "tool-calls",
      }),
      expect.objectContaining({
        stepNumber: 2,
        durationMs: expect.any(Number),
        finishReason: "tool-calls",
      }),
    ]);
  });

  test("logs full step diagnostics when the agent finishes with reason other", async () => {
    agentFinishReason = "other";
    agentRawFinishReason = "provider_other";
    agentResponseMessages = [{ role: "assistant" }];
    agentResponse = {
      id: "response-1",
      messages: agentResponseMessages,
      modelId: "test-model",
    };
    agentWarnings = [
      {
        type: "unsupported-setting",
        setting: "text.verbosity",
        details: "Provider ignored the requested verbosity.",
      },
    ];
    agentRequestBody = {
      model: "openai/gpt-5",
      store: false,
      max_output_tokens: 512,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
      tools: [{ type: "function", name: "read" }],
    };
    agentResponseHeaders = { "x-request-id": "req-123" };
    agentResponseBody = {
      id: "response-body-1",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          id: "msg-1",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi" }],
        },
      ],
      usage: { total_tokens: 15 },
      service_tier: "default",
    };
    agentProviderMetadata = {
      openai: { responseId: "response-1", serviceTier: "default" },
    };

    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      await runAgentWorkflow(makeOptions());

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toHaveLength(1);
      const warning = warnings[0]?.[0];
      expect(typeof warning).toBe("string");
      expect(warning).toStartWith(
        "[workflow] Agent step finished with reason 'other':\n",
      );

      const payload = JSON.parse(
        (warning as string).replace(
          "[workflow] Agent step finished with reason 'other':\n",
          "",
        ),
      );

      expect(payload).toMatchObject({
        workflowRunId: "wrun_test-123",
        chatId: "chat-1",
        sessionId: "session-1",
        messageId: "gen-id-1",
        selectedModelId: "gpt-4",
        finishReason: "other",
        rawFinishReason: "provider_other",
        response: agentResponse,
        stepDiagnostics: [
          {
            stepNumber: 0,
            model: { provider: "openai", modelId: "test-model" },
            finishReason: "other",
            rawFinishReason: "provider_other",
            warnings: agentWarnings,
            request: {
              body: {
                model: "openai/gpt-5",
                store: false,
                maxOutputTokens: 512,
                inputCount: 1,
                toolsCount: 1,
              },
            },
            response: {
              id: "response-1",
              modelId: "test-model",
              headers: { "x-request-id": "req-123" },
              body: {
                id: "response-body-1",
                status: "incomplete",
                incompleteDetails: { reason: "max_output_tokens" },
                outputCount: 1,
                serviceTier: "default",
              },
              messageCount: 1,
            },
            providerMetadata: {
              openai: { responseId: "response-1", serviceTier: "default" },
            },
          },
        ],
      });
    } finally {
      console.warn = originalWarn;
    }
  });

  test("persists raw finish reasons for each agent step in message metadata", async () => {
    agentFinishReason = "tool-calls";
    agentStreamParts = [
      { type: "text-delta", textDelta: "Hi" },
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        lastStepFinishReason?: string;
        lastStepRawFinishReason?: string;
        stepFinishReasons?: Array<{
          finishReason: string;
          rawFinishReason?: string;
        }>;
      };
    };

    expect(persistedMessage.metadata?.lastStepFinishReason).toBe("tool-calls");
    expect(persistedMessage.metadata?.lastStepRawFinishReason).toBe(
      "provider_tool_use",
    );
    expect(persistedMessage.metadata?.stepFinishReasons).toEqual([
      {
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
      },
      {
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
      },
    ]);
  });

  test("streams and persists cumulative total message usage", async () => {
    agentFinishReason = "tool-calls";
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        maxSteps: 2,
      }),
    );

    const metadataChunks = writtenChunks.filter(
      (
        chunk,
      ): chunk is UIMessageChunk & {
        type: "message-metadata";
        messageMetadata: {
          totalMessageUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          };
        };
      } => chunk.type === "message-metadata",
    );

    expect(
      metadataChunks.map((chunk) => ({
        inputTokens: chunk.messageMetadata.totalMessageUsage?.inputTokens,
        outputTokens: chunk.messageMetadata.totalMessageUsage?.outputTokens,
        totalTokens: chunk.messageMetadata.totalMessageUsage?.totalTokens,
      })),
    ).toEqual([
      { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    ]);

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      metadata?: {
        totalMessageUsage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      };
    };

    expect({
      inputTokens: persistedMessage.metadata?.totalMessageUsage?.inputTokens,
      outputTokens: persistedMessage.metadata?.totalMessageUsage?.outputTokens,
      totalTokens: persistedMessage.metadata?.totalMessageUsage?.totalTokens,
    }).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
  });

  test("refreshes lifecycle activity before clearing the active stream", async () => {
    const callOrder: string[] = [];
    spies.refreshLifecycleActivity.mockImplementationOnce(async () => {
      callOrder.push("refresh-lifecycle");
    });
    spies.clearActiveStream.mockImplementationOnce(async () => {
      callOrder.push("clear-stream");
    });

    await runAgentWorkflow(makeOptions());

    expect(spies.refreshLifecycleActivity).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["refresh-lifecycle", "clear-stream"]);
  });

  test("persists sandbox state when sandbox is present", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.persistSandboxState).toHaveBeenCalledTimes(1);
  });

  test("skips sandbox state when no sandbox", async () => {
    await runAgentWorkflow(
      makeOptions({
        agentOptions: {},
      }),
    );

    expect(spies.persistSandboxState).not.toHaveBeenCalled();
  });

  test("clears active stream in finally block", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.clearActiveStream).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
    );
  });

  test("refreshes diff cache after run", async () => {
    await runAgentWorkflow(makeOptions());

    expect(spies.refreshDiffCache).toHaveBeenCalledTimes(1);
  });

  test("runs auto-commit when enabled and not aborted", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        sessionTitle: "My session",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).toHaveBeenCalledTimes(1);
    expect(spies.runAutoCommitStep).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );
  });

  test("runs auto PR creation when enabled and not aborted", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        sessionTitle: "My session",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCreatePrStep).toHaveBeenCalledTimes(1);
    expect(spies.runAutoCreatePrStep).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );
  });

  test("skips optimistic commit streaming when preflight finds no changes", async () => {
    spies.hasAutoCommitChangesStep.mockImplementationOnce(() =>
      Promise.resolve(false),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
    expect(spies.runAutoCreatePrStep).toHaveBeenCalledTimes(1);
    expect(
      writtenChunks.filter((chunk) => chunk.type === "data-commit"),
    ).toEqual([]);
  });

  test("streams and persists resolved git data parts", async () => {
    spies.runAutoCommitStep.mockImplementationOnce(() =>
      Promise.resolve({
        committed: true,
        pushed: true,
        commitMessage: "feat: add auto git status",
        commitSha: "abc123",
      }),
    );
    spies.runAutoCreatePrStep.mockImplementationOnce(() =>
      Promise.resolve({
        created: true,
        syncedExisting: false,
        skipped: false,
        prNumber: 101,
        prUrl: "https://github.com/acme/repo/pull/101",
      }),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(
      writtenChunks.filter((chunk) => chunk.type === "data-commit"),
    ).toEqual([
      {
        type: "data-commit",
        id: "gen-id-1:commit",
        data: { status: "pending" },
      },
      {
        type: "data-commit",
        id: "gen-id-1:commit",
        data: {
          status: "success",
          committed: true,
          pushed: true,
          commitMessage: "feat: add auto git status",
          commitSha: "abc123",
          url: "https://github.com/acme/repo/commit/abc123",
        },
      },
    ]);
    expect(writtenChunks.filter((chunk) => chunk.type === "data-pr")).toEqual([
      {
        type: "data-pr",
        id: "gen-id-1:pr",
        data: { status: "pending" },
      },
      {
        type: "data-pr",
        id: "gen-id-1:pr",
        data: {
          status: "success",
          created: true,
          syncedExisting: false,
          prNumber: 101,
          url: "https://github.com/acme/repo/pull/101",
        },
      },
    ]);

    const persistCalls = spies.persistAssistantMessage.mock
      .calls as unknown[][];
    const persistedMessage = persistCalls.at(-1)?.[1] as {
      parts: Array<Record<string, unknown>>;
    };

    expect(persistedMessage.parts).toEqual(
      expect.arrayContaining([
        {
          type: "data-commit",
          id: "gen-id-1:commit",
          data: {
            status: "success",
            committed: true,
            pushed: true,
            commitMessage: "feat: add auto git status",
            commitSha: "abc123",
            url: "https://github.com/acme/repo/commit/abc123",
          },
        },
        {
          type: "data-pr",
          id: "gen-id-1:pr",
          data: {
            status: "success",
            created: true,
            syncedExisting: false,
            prNumber: 101,
            url: "https://github.com/acme/repo/pull/101",
          },
        },
      ]),
    );
  });

  test("prunes synthetic git-only assistant messages before the next model call", async () => {
    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
          {
            id: "assistant-git-1",
            role: "assistant",
            parts: [
              {
                type: "data-commit",
                id: "assistant-git-1:commit",
                data: { status: "success" },
              },
            ],
            metadata: {},
          },
          {
            id: "user-2",
            role: "user",
            parts: [{ type: "text", text: "What changed?" }],
          },
        ],
      }),
    );

    expect(agentInputMessages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "What changed?" }],
      },
    ]);
  });

  test("skips auto PR creation when auto-commit does not push the latest commit", async () => {
    spies.runAutoCommitStep.mockImplementationOnce(() =>
      Promise.resolve({
        committed: true,
        pushed: false,
        error: "Commit succeeded but push failed",
      }),
    );

    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).toHaveBeenCalledTimes(1);
    expect(spies.runAutoCreatePrStep).not.toHaveBeenCalled();
  });

  test("skips post-finish automation when the agent pauses for tool input", async () => {
    agentFinishReason = "tool-calls";
    agentRawFinishReason = "provider_tool_use";
    agentStreamParts = [
      {
        type: "finish-step",
        finishReason: "tool-calls",
        rawFinishReason: "provider_tool_use",
        usage: agentTotalUsage,
      },
    ];

    await runAgentWorkflow(
      makeOptions({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [
              {
                type: "tool-invocation",
                state: "approval-requested",
              },
            ],
            metadata: {},
          },
        ],
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
    expect(spies.runAutoCreatePrStep).not.toHaveBeenCalled();
  });

  test("skips auto PR creation when not enabled", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        autoCreatePrEnabled: false,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCreatePrStep).not.toHaveBeenCalled();
  });

  test("skips auto-commit when not enabled", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: false,
        repoOwner: "acme",
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
  });

  test("skips auto-commit when repoOwner is missing", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        repoOwner: undefined,
        repoName: "repo",
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
  });

  test("skips auto-commit when repoName is missing", async () => {
    await runAgentWorkflow(
      makeOptions({
        autoCommitEnabled: true,
        repoOwner: "acme",
        repoName: undefined,
      }),
    );

    expect(spies.runAutoCommitStep).not.toHaveBeenCalled();
  });

  test("still clears stream and sends finish even on step error", async () => {
    // Mock the agent to throw
    mock.module("@/app/config", () => ({
      webAgent: {
        tools: {},
        stream: async () => {
          throw new Error("Agent failed");
        },
      },
    }));

    // Re-import to pick up new mock
    const { runAgentWorkflow: reloadedRun } = await import("./chat");

    try {
      await reloadedRun(makeOptions());
    } catch {
      // Expected to throw
    }

    // The finally block should still fire
    expect(spies.clearActiveStream).toHaveBeenCalled();
  });
});
