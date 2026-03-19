import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

interface TestSessionRecord {
  id: string;
  userId: string;
  title: string;
  cloneUrl: string;
  repoOwner: string;
  repoName: string;
  autoCommitPushOverride?: boolean | null;
  sandboxState: {
    type: "vercel";
  };
}

interface TestChatRecord {
  sessionId: string;
  modelId: string | null;
  activeStreamId: string | null;
}

let sessionRecord: TestSessionRecord | null;
let chatRecord: TestChatRecord | null;
let currentAuthSession: { user: { id: string } } | null;
let isSandboxActive = true;
let existingRunStatus: string = "completed";
let compareAndSetResult = true;

const originalFetch = globalThis.fetch;

globalThis.fetch = (async (_input: RequestInfo | URL) => {
  return new Response("{}", {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}) as typeof fetch;

mock.module("next/server", () => ({
  after: (task: Promise<unknown>) => {
    void Promise.resolve(task);
  },
}));

mock.module("ai", () => ({
  createUIMessageStreamResponse: ({
    stream,
    headers,
  }: {
    stream: ReadableStream;
    headers?: Record<string, string>;
  }) => new Response(stream, { status: 200, headers }),
}));

mock.module("workflow/api", () => ({
  start: async () => ({
    runId: "wrun_test-123",
    getReadable: () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
  }),
  getRun: () => ({
    status: Promise.resolve(existingRunStatus),
    getReadable: () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    cancel: () => Promise.resolve(),
  }),
}));

mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow: async () => {},
}));

mock.module("@/lib/chat/create-cancelable-readable-stream", () => ({
  createCancelableReadableStream: (stream: ReadableStream) => stream,
}));

mock.module("@open-harness/agent", () => ({
  discoverSkills: async () => [],
  gateway: () => "mock-model",
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

const persistAssistantMessagesWithToolResultsSpy = mock(() =>
  Promise.resolve(),
);

mock.module("./_lib/persist-tool-results", () => ({
  persistAssistantMessagesWithToolResults:
    persistAssistantMessagesWithToolResultsSpy,
}));

mock.module("@/lib/db/sessions", () => ({
  compareAndSetChatActiveStreamId: async () => compareAndSetResult,
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

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    autoCommitPush: true,
    modelVariants: [],
  }),
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
    isSandboxActive = true;
    existingRunStatus = "completed";
    compareAndSetResult = true;
    persistAssistantMessagesWithToolResultsSpy.mockClear();
    currentAuthSession = {
      user: {
        id: "user-1",
      },
    };

    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session title",
      cloneUrl: "https://github.com/acme/repo.git",
      repoOwner: "acme",
      repoName: "repo",
      autoCommitPushOverride: null,
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

  test("starts a workflow and returns a streaming response", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
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

  test("reconnects to existing running workflow instead of starting new one", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_existing-456";
    existingRunStatus = "running";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    // Should include the existing run ID header
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_existing-456");
  });

  test("starts new workflow when existing run is completed", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_old-789";
    existingRunStatus = "completed";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    // Should get the new run ID, not the old one
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");
  });

  test("returns 409 when CAS race is lost", async () => {
    compareAndSetResult = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Another workflow is already running for this chat",
    });
  });

  test("includes x-workflow-run-id header on success", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");
  });

  test("calls persistAssistantMessagesWithToolResults on submit", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());
    expect(response.ok).toBe(true);

    // Wait for the fire-and-forget call to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(persistAssistantMessagesWithToolResultsSpy).toHaveBeenCalledTimes(1);
    expect(persistAssistantMessagesWithToolResultsSpy).toHaveBeenCalledWith(
      "chat-1",
      expect.any(Array),
    );
  });
});
