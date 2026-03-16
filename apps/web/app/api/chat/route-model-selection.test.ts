import { beforeEach, describe, expect, mock, test } from "bun:test";

interface TestChatRecord {
  modelId: string | null;
}

interface TestProviderOptionsByProvider {
  [provider: string]: Record<string, unknown>;
}

interface TestAgentModelSelection {
  id: string;
  providerOptionsOverrides?: TestProviderOptionsByProvider;
}

interface TestStreamCall {
  options: {
    model: TestAgentModelSelection;
    subagentModel?: TestAgentModelSelection;
  };
}

interface TestUserPreferences {
  autoCommitPush: boolean;
  modelVariants: unknown[];
  defaultSubagentModelId: string | null;
}

interface ResolveModelSelectionResult {
  isMissingVariant: boolean;
  resolvedModelId: string;
  providerOptionsByProvider?: TestProviderOptionsByProvider;
}

const sessionRecord = {
  sandboxState: {
    type: "vercel" as const,
  },
};

const sandboxRuntime = {
  workingDirectory: "/vercel/sandbox",
  currentBranch: "main",
  environmentDetails: "Test sandbox",
  getState: () => sessionRecord.sandboxState,
};

let chatRecord: TestChatRecord;
let lastStreamCall: TestStreamCall | null = null;
let resolveModelSelectionImpl: (
  modelId: string,
  modelVariants: unknown[],
) => ResolveModelSelectionResult;
let userPreferences: TestUserPreferences;

mock.module("ai", () => ({
  convertToModelMessages: async (messages: unknown) => messages,
}));

mock.module("@/app/config", () => ({
  webAgent: {
    tools: {},
    stream: async (input: TestStreamCall) => {
      lastStreamCall = input;
      return {
        consumeStream: async () => {},
        toUIMessageStreamResponse: async () =>
          new Response("ok", { status: 200 }),
      };
    },
  },
}));

mock.module("@/lib/db/sessions", () => ({
  updateChatAssistantActivity: async () => {},
  updateSession: async () => ({}),
  upsertChatMessageScoped: async () => ({ status: "inserted" as const }),
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => userPreferences,
}));

mock.module("@/lib/model-variants", () => ({
  resolveModelSelection: (modelId: string, modelVariants: unknown[]) =>
    resolveModelSelectionImpl(modelId, modelVariants),
}));

mock.module("@/lib/models", () => ({
  DEFAULT_MODEL_ID: "mock-model",
}));

mock.module("@/lib/resumable-stream-context", () => ({
  resumableStreamContext: {
    createNewResumableStream: async () => {},
  },
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
}));

mock.module("./_lib/chat-context", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true as const,
    userId: "user-1",
  }),
  requireOwnedSessionChat: async () => ({
    ok: true as const,
    sessionRecord,
    chat: chatRecord,
  }),
}));

mock.module("./_lib/message-persistence", () => ({
  scheduleLatestMessagePersistence: () => null,
}));

mock.module("./_lib/post-finish", () => ({
  handleChatStreamFinish: async () => {},
}));

mock.module("./_lib/request", () => ({
  parseChatRequestBody: async (req: Request) => ({
    ok: true as const,
    body: await req.json(),
  }),
  requireChatIdentifiers: (body: { sessionId: string; chatId: string }) => ({
    ok: true as const,
    sessionId: body.sessionId,
    chatId: body.chatId,
  }),
}));

mock.module("./_lib/runtime", () => ({
  createChatRuntime: async () => ({ sandbox: sandboxRuntime, skills: [] }),
}));

mock.module("./_lib/stream-lifecycle", () => ({
  claimStreamOwnership: async () => true,
  createOwnedStreamTokenClearer: () => async () => true,
  createStreamToken: () => "stream-1",
  setupStreamAbortLifecycle: async () => ({
    controller: new AbortController(),
    cleanup: () => {},
    shouldAutoCommitOnFinish: () => false,
  }),
}));

const routeModulePromise = import("./route");

function createValidRequest() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "session-1",
      chatId: "chat-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Fix the bug" }],
        },
      ],
    }),
  });
}

describe("/api/chat route model selection", () => {
  beforeEach(() => {
    chatRecord = { modelId: null };
    lastStreamCall = null;
    resolveModelSelectionImpl = (modelId: string) => ({
      isMissingVariant: false,
      resolvedModelId: modelId,
      providerOptionsByProvider: undefined,
    });
    userPreferences = {
      autoCommitPush: true,
      modelVariants: [],
      defaultSubagentModelId: null,
    };
  });

  test("passes direct model ids through to the agent", async () => {
    chatRecord.modelId = "openai/gpt-5";
    userPreferences.defaultSubagentModelId = "openai/gpt-5-mini";

    const { POST } = await routeModulePromise;
    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(lastStreamCall?.options.model).toEqual({
      id: "openai/gpt-5",
    });
    expect(lastStreamCall?.options.subagentModel).toEqual({
      id: "openai/gpt-5-mini",
    });
  });

  test("passes resolved variant selections through to the agent", async () => {
    chatRecord.modelId = "variant:main";
    userPreferences.defaultSubagentModelId = "variant:subagent";

    const mainProviderOptions: TestProviderOptionsByProvider = {
      openai: {
        reasoningEffort: "medium",
      },
    };
    const subagentProviderOptions: TestProviderOptionsByProvider = {
      anthropic: {
        budgetTokens: 4000,
      },
    };

    resolveModelSelectionImpl = (
      modelId: string,
    ): ResolveModelSelectionResult => {
      if (modelId === "variant:main") {
        return {
          isMissingVariant: false,
          resolvedModelId: "openai/gpt-5",
          providerOptionsByProvider: mainProviderOptions,
        };
      }

      if (modelId === "variant:subagent") {
        return {
          isMissingVariant: false,
          resolvedModelId: "anthropic/claude-sonnet-4.5",
          providerOptionsByProvider: subagentProviderOptions,
        };
      }

      return {
        isMissingVariant: false,
        resolvedModelId: modelId,
        providerOptionsByProvider: undefined,
      };
    };

    const { POST } = await routeModulePromise;
    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(lastStreamCall?.options.model).toEqual({
      id: "openai/gpt-5",
      providerOptionsOverrides: mainProviderOptions,
    });
    expect(lastStreamCall?.options.subagentModel).toEqual({
      id: "anthropic/claude-sonnet-4.5",
      providerOptionsOverrides: subagentProviderOptions,
    });
  });

  test("falls back to the default model when a variant is missing", async () => {
    chatRecord.modelId = "variant:missing-main";
    userPreferences.defaultSubagentModelId = "variant:missing-subagent";

    resolveModelSelectionImpl = (modelId: string) => ({
      isMissingVariant: modelId.startsWith("variant:missing"),
      resolvedModelId: modelId,
      providerOptionsByProvider: {
        openai: {
          reasoningEffort: "low",
        },
      },
    });

    const { POST } = await routeModulePromise;
    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(lastStreamCall?.options.model).toEqual({
      id: "mock-model",
    });
    expect(lastStreamCall?.options.subagentModel).toEqual({
      id: "mock-model",
    });
  });
});
