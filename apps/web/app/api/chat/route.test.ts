import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

interface TestSessionRecord {
  id: string;
  userId: string;
  title: string;
  cloneUrl: string;
  repoOwner: string;
  repoName: string;
  sandboxState: {
    type: "vercel";
  };
}

interface TestChatRecord {
  sessionId: string;
  modelId: string | null;
  activeStreamId: string | null;
}

interface StreamResponseOptions {
  onFinish: (params: {
    responseMessage: {
      id: string;
      role: "assistant";
      parts: unknown[];
    };
  }) => Promise<void>;
}

const autoCommitCalls: Array<Record<string, unknown>> = [];
const backgroundTasks: Promise<void>[] = [];
const fetchCalls: string[] = [];

let sessionRecord: TestSessionRecord | null;
let chatRecord: TestChatRecord | null;
let currentAuthSession: { user: { id: string } } | null;
let isSandboxActive = true;
let shouldTriggerStopBeforeFinish = false;
let stopCallback: (() => void) | null = null;

const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetchCalls.push(String(input));
  return new Response("{}", {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}) as typeof fetch;

mock.module("next/server", () => ({
  after: (task: Promise<unknown>) => {
    backgroundTasks.push(Promise.resolve(task).then(() => undefined));
  },
}));

mock.module("ai", () => ({
  convertToModelMessages: async (messages: unknown) => messages,
}));

mock.module("@/app/config", () => ({
  webAgent: {
    tools: {},
    stream: async () => {
      let resolveConsumeStream: (() => void) | null = null;

      return {
        consumeStream: () =>
          new Promise<void>((resolve) => {
            resolveConsumeStream = resolve;
          }),
        toUIMessageStreamResponse: async ({
          onFinish,
        }: StreamResponseOptions) => {
          if (shouldTriggerStopBeforeFinish) {
            stopCallback?.();
          }

          await onFinish({
            responseMessage: {
              id: "assistant-1",
              role: "assistant",
              parts: [],
            },
          });

          resolveConsumeStream?.();
          return new Response("ok", { status: 200 });
        },
      };
    },
  },
}));

mock.module("@open-harness/agent", () => ({
  collectTaskToolUsageEvents: () => [],
  discoverSkills: async () => [],
  gateway: () => "mock-model",
  sumLanguageModelUsage: (_existing: unknown, usage: unknown) => usage,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/vercel/sandbox",
    exec: async () => ({ success: true, stdout: "", stderr: "" }),
    getState: () => ({
      type: "vercel",
      sandboxId: "sandbox-1",
      expiresAt: Date.now() + 60_000,
    }),
  }),
}));

mock.module("@/lib/db/sessions", () => ({
  compareAndSetChatActiveStreamId: async () => true,
  createChatMessageIfNotExists: async () => undefined,
  getChatById: async () => chatRecord,
  getSessionById: async () => sessionRecord,
  isFirstChatMessage: async () => false,
  touchChat: async () => {},
  updateChat: async () => {},
  updateChatActiveStreamId: async () => {},
  updateChatAssistantActivity: async () => {},
  updateSession: async (_sessionId: string, patch: Record<string, unknown>) =>
    patch,
  upsertChatMessageScoped: async () => ({ status: "inserted" as const }),
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage: async () => {},
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    autoCommitPush: true,
    modelVariants: [],
  }),
}));

mock.module("@/lib/chat-auto-commit", () => ({
  runAutoCommitInBackground: async (params: Record<string, unknown>) => {
    autoCommitCalls.push(params);
  },
}));

mock.module("@/lib/github/get-repo-token", () => ({
  getRepoToken: async () => ({ token: null }),
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => [],
  setCachedSkills: async () => {},
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/model-variants", () => ({
  resolveModelSelection: (modelId: string) => ({
    isMissingVariant: false,
    resolvedModelId: modelId,
    providerOptionsByProvider: undefined,
  }),
}));

mock.module("@/lib/models", () => ({
  DEFAULT_MODEL_ID: "mock-model",
}));

mock.module("@/lib/resumable-stream-context", () => ({
  resumableStreamContext: {
    createNewResumableStream: async () => {},
  },
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_PORTS: [],
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => isSandboxActive,
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentAuthSession,
}));

mock.module("@/lib/stop-signal", () => ({
  onStopSignal: async (_chatId: string, callback: () => void) => {
    stopCallback = callback;
    return () => {
      stopCallback = null;
    };
  },
}));

const routeModulePromise = import("./route");

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function createRequest(body: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "session=abc",
    },
    body,
  });
}

function createValidRequest() {
  return createRequest(
    JSON.stringify({
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
  );
}

describe("/api/chat route", () => {
  beforeEach(() => {
    autoCommitCalls.length = 0;
    backgroundTasks.length = 0;
    fetchCalls.length = 0;
    shouldTriggerStopBeforeFinish = false;
    stopCallback = null;
    currentAuthSession = {
      user: {
        id: "user-1",
      },
    };
    isSandboxActive = true;

    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session title",
      cloneUrl: "https://github.com/acme/repo.git",
      repoOwner: "acme",
      repoName: "repo",
      sandboxState: {
        type: "vercel",
      },
    };

    chatRecord = {
      sessionId: "session-1",
      modelId: null,
      activeStreamId: null,
    };
  });

  test("runs auto commit after a natural finish", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    await Promise.all(backgroundTasks);

    expect(response.ok).toBe(true);
    expect(autoCommitCalls).toHaveLength(1);
    expect(autoCommitCalls[0]).toMatchObject({
      sessionId: "session-1",
      sessionTitle: "Session title",
      repoOwner: "acme",
      repoName: "repo",
    });
    expect(fetchCalls).toEqual([
      "http://localhost/api/sessions/session-1/diff",
    ]);
  });

  test("skips auto commit when the chat is stopped", async () => {
    shouldTriggerStopBeforeFinish = true;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    await Promise.all(backgroundTasks);

    expect(response.ok).toBe(true);
    expect(autoCommitCalls).toHaveLength(0);
    expect(fetchCalls).toEqual([
      "http://localhost/api/sessions/session-1/diff",
    ]);
  });

  test("returns 401 when not authenticated", async () => {
    currentAuthSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
  });

  test("returns 400 for invalid JSON body", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });
  });

  test("returns 400 when sessionId and chatId are missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest(
        JSON.stringify({
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Fix the bug" }],
            },
          ],
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "sessionId and chatId are required",
    });
  });

  test("returns 404 when session does not exist", async () => {
    sessionRecord = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Session not found",
    });
  });

  test("returns 403 when session is not owned by user", async () => {
    if (!sessionRecord) {
      throw new Error("sessionRecord must be set");
    }
    sessionRecord.userId = "user-2";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  test("returns 400 when sandbox is not active", async () => {
    isSandboxActive = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Sandbox not initialized",
    });
  });
});
