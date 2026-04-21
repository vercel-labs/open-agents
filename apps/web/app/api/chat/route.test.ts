import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { assistantFileLinkPrompt } from "@/lib/assistant-file-links";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  title: string;
  cloneUrl: string;
  repoOwner: string;
  repoName: string;
  prNumber?: number | null;
  autoCommitPushOverride?: boolean | null;
  autoCreatePrOverride?: boolean | null;
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
let currentAuthSession: {
  authProvider?: "vercel" | "github";
  user: {
    id: string;
    email?: string;
  };
} | null;
let existingUserMessageCount = 0;
let existingChatMessage: { id: string } | null = null;
let isSandboxActive = true;
let existingRunStatus: string = "completed";
let getRunShouldThrow = false;
let claimActiveStreamDefaultResult = true;
let compareAndSetDefaultResult = true;
let compareAndSetResults: boolean[] = [];
let startCalls: unknown[][] = [];
let preferencesState: {
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  modelVariants: Array<{
    id: string;
    name: string;
    baseModelId: string;
    providerOptions: Record<string, unknown>;
  }>;
} = {
  autoCommitPush: true,
  autoCreatePr: false,
  modelVariants: [],
};
let cachedSkillsState: unknown = null;
let discoverSkillDirsCalls: string[][] = [];

const claimChatActiveStreamIdSpy = mock(
  async () => claimActiveStreamDefaultResult,
);

const compareAndSetChatActiveStreamIdSpy = mock(async () => {
  const nextResult = compareAndSetResults.shift();
  return nextResult ?? compareAndSetDefaultResult;
});

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
  start: async (...args: unknown[]) => {
    startCalls.push(args);
    return {
      runId: "wrun_test-123",
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    };
  },
  getRun: () => {
    if (getRunShouldThrow) {
      throw new Error("Run not found");
    }

    return {
      status: Promise.resolve(existingRunStatus),
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      cancel: () => Promise.resolve(),
    };
  },
}));

mock.module("@/app/workflows/chat", () => ({
  runAgentWorkflow: async () => {},
}));

mock.module("@/lib/chat/create-cancelable-readable-stream", () => ({
  createCancelableReadableStream: (stream: ReadableStream) => stream,
}));

mock.module("@open-agents/agent", () => ({
  discoverSkills: async (_sandbox: unknown, skillDirs: string[]) => {
    discoverSkillDirsCalls.push(skillDirs);
    return [];
  },
  gateway: () => "mock-model",
}));

mock.module("@open-agents/sandbox", () => ({
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
  claimChatActiveStreamId: claimChatActiveStreamIdSpy,
  compareAndSetChatActiveStreamId: compareAndSetChatActiveStreamIdSpy,
  countUserMessagesByUserId: async () => existingUserMessageCount,
  createChatMessageIfNotExists: async () => undefined,
  getChatById: async () => chatRecord,
  getChatMessageById: async () => existingChatMessage,
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
  getUserPreferences: async () => preferencesState,
}));

mock.module("@/lib/skills-cache", () => ({
  getCachedSkills: async () => cachedSkillsState,
  setCachedSkills: async () => {},
}));

mock.module("@/lib/github/token", () => ({
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

function createRequest(body: string, url = "http://localhost/api/chat") {
  return new Request(url, {
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
    getRunShouldThrow = false;
    claimActiveStreamDefaultResult = true;
    compareAndSetDefaultResult = true;
    compareAndSetResults = [];
    startCalls = [];
    cachedSkillsState = null;
    discoverSkillDirsCalls = [];
    existingUserMessageCount = 0;
    existingChatMessage = null;
    preferencesState = {
      autoCommitPush: true,
      autoCreatePr: false,
      modelVariants: [],
    };
    claimChatActiveStreamIdSpy.mockClear();
    compareAndSetChatActiveStreamIdSpy.mockClear();
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
      prNumber: null,
      autoCommitPushOverride: null,
      autoCreatePrOverride: null,
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

  test("blocks a sixth message for non-Vercel trial users on the managed deployment", async () => {
    const { POST } = await routeModulePromise;
    currentAuthSession = {
      authProvider: "vercel",
      user: {
        id: "user-1",
        email: "person@example.com",
      },
    };
    existingUserMessageCount = 5;

    const response = await POST(
      createRequest(
        JSON.stringify({
          sessionId: "session-1",
          chatId: "chat-1",
          messages: [
            {
              id: "user-6",
              role: "user",
              parts: [{ type: "text", text: "One more thing" }],
            },
          ],
        }),
        "https://open-agents.dev/api/chat",
      ),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "This hosted deployment has a 5 message limit. Deploy your own copy for no limit at open-agents.dev/deploy-your-own.",
    );
    expect(startCalls).toHaveLength(0);
  });

  test("passes the 500 maxSteps limit to the workflow", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.objectContaining({
        maxSteps: 500,
        agentOptions: expect.objectContaining({
          customInstructions: assistantFileLinkPrompt,
        }),
      }),
    ]);
  });

  test("passes selected and resolved model ids to the workflow", async () => {
    const { POST } = await routeModulePromise;
    if (!chatRecord) {
      throw new Error("chatRecord must be set");
    }

    chatRecord.modelId = "variant:test-model";
    preferencesState.modelVariants = [
      {
        id: "variant:test-model",
        name: "Test model",
        baseModelId: "openai/gpt-5",
        providerOptions: {},
      },
    ];

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.objectContaining({
        selectedModelId: "variant:test-model",
        modelId: "openai/gpt-5",
      }),
    ]);
  });

  test("discovers global sandbox skills after repo-local skill directories", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(discoverSkillDirsCalls).toEqual([
      [
        "/vercel/sandbox/.claude/skills",
        "/vercel/sandbox/.agents/skills",
        "/root/.agents/skills",
      ],
    ]);
  });

  test("passes autoCreatePrEnabled when auto commit and auto PR are enabled", async () => {
    const { POST } = await routeModulePromise;
    preferencesState.autoCreatePr = true;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.objectContaining({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
      }),
    ]);
  });

  test("keeps auto PR enabled when the session already has PR metadata", async () => {
    const { POST } = await routeModulePromise;
    preferencesState.autoCreatePr = true;
    if (!sessionRecord) {
      throw new Error("sessionRecord must be set");
    }
    sessionRecord.prNumber = 42;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.objectContaining({
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
      }),
    ]);
  });

  test("does not enable auto PR when auto commit is disabled", async () => {
    const { POST } = await routeModulePromise;
    preferencesState.autoCommitPush = false;
    preferencesState.autoCreatePr = true;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]).toEqual([
      expect.not.objectContaining({
        autoCommitEnabled: true,
      }),
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

  test("reconnects to existing running workflow instead of starting new one", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_existing-456";
    existingRunStatus = "running";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_existing-456");
    expect(startCalls).toHaveLength(0);
    expect(compareAndSetChatActiveStreamIdSpy).not.toHaveBeenCalled();
  });

  test("starts new workflow when existing run is completed and clears the stale stream id first", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_old-789";
    existingRunStatus = "completed";

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");

    const compareAndSetCalls = compareAndSetChatActiveStreamIdSpy.mock
      .calls as unknown[][];
    expect(compareAndSetCalls).toEqual([["chat-1", "wrun_old-789", null]]);
    expect(claimChatActiveStreamIdSpy).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
    );
  });

  test("starts new workflow when the existing run cannot be loaded and clears the stale stream id first", async () => {
    if (!chatRecord) throw new Error("chatRecord must be set");
    chatRecord.activeStreamId = "wrun_missing-789";
    getRunShouldThrow = true;

    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(response.headers.get("x-workflow-run-id")).toBe("wrun_test-123");

    const compareAndSetCalls = compareAndSetChatActiveStreamIdSpy.mock
      .calls as unknown[][];
    expect(compareAndSetCalls).toEqual([["chat-1", "wrun_missing-789", null]]);
    expect(claimChatActiveStreamIdSpy).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
    );
  });

  test("succeeds when the started workflow already claimed the stream slot", async () => {
    compareAndSetDefaultResult = false;
    const { POST } = await routeModulePromise;

    const response = await POST(createValidRequest());

    expect(response.ok).toBe(true);
    expect(claimChatActiveStreamIdSpy).toHaveBeenCalledWith(
      "chat-1",
      "wrun_test-123",
    );
  });

  test("returns 409 when a different workflow owns the stream slot", async () => {
    claimActiveStreamDefaultResult = false;
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
