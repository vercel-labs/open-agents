import { beforeEach, describe, expect, mock, test } from "bun:test";

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: string; text?: string }>;
}

interface TestChat {
  id: string;
  sessionId: string;
  modelId: string | null;
  activeStreamId: string | null;
}

interface UpsertScopedInput {
  id: string;
  chatId: string;
  role: "assistant";
  parts: unknown;
}

let nextNanoId = 0;
const nanoIds = ["request-token", "stream-token", "message-token"];
const getNanoId = () => {
  const value = nanoIds[nextNanoId];
  nextNanoId += 1;
  return value ?? `fallback-${nextNanoId}`;
};

const sessionRecord = {
  id: "session-1",
  userId: "user-1",
  sandboxState: {
    type: "vercel",
    sandboxId: "sbx-1",
    expiresAt: Date.now() + 60_000,
  },
  repoOwner: null,
  repoName: null,
};

let chatState: TestChat;
let getChatByIdCallCount = 0;
let loseOwnershipOnFinish = false;
let stealOwnershipDuringFinalize = false;
let upsertConflict = false;
const activeStreamAtRegistration: Array<string | null> = [];

const upsertScopedCalls: UpsertScopedInput[] = [];
const compareAndSetCalls: Array<{
  chatId: string;
  expected: string | null;
  next: string | null;
}> = [];

mock.module("@open-harness/agent", () => ({
  discoverSkills: async () => [],
  gateway: () => ({ provider: "test-model" }),
}));

mock.module("ai", () => ({
  convertToModelMessages: async () => [],
}));

mock.module("nanoid", () => ({
  nanoid: () => getNanoId(),
}));

const responseMessage: TestMessage = {
  id: "assistant-final",
  role: "assistant",
  parts: [{ type: "text", text: "done" }],
};

mock.module("@/app/config", () => ({
  webAgent: {
    tools: {},
    stream: async () => ({
      consumeStream: async () => {},
      toUIMessageStreamResponse: async ({
        consumeSseStream,
        onFinish,
      }: {
        consumeSseStream: (input: {
          stream: ReadableStream<Uint8Array>;
        }) => Promise<void>;
        onFinish: (input: { responseMessage: TestMessage }) => Promise<void>;
      }) => {
        await consumeSseStream({ stream: new ReadableStream<Uint8Array>() });
        if (loseOwnershipOnFinish) {
          chatState.activeStreamId = "newer-stream-token";
        }
        await onFinish({ responseMessage });
        return new Response("ok", { status: 200 });
      },
    }),
  },
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/workspace",
    exec: async () => ({ success: true, stdout: "", stderr: "" }),
    getState: () => sessionRecord.sandboxState,
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

mock.module("@/lib/github/get-repo-token", () => ({
  getRepoToken: async () => ({ token: "ghs_token" }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/models", () => ({
  DEFAULT_MODEL_ID: "test-model",
}));

mock.module("@/lib/resumable-stream-context", () => ({
  resumableStreamContext: {
    createNewResumableStream: async () => {
      activeStreamAtRegistration.push(chatState.activeStreamId);
    },
  },
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: () => ({}),
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: () => {},
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => true,
}));

mock.module("@/lib/stop-signal", () => ({
  onStopSignal: async () => () => {},
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
  getChatById: async () => {
    getChatByIdCallCount += 1;
    if (getChatByIdCallCount === 1) {
      return { ...chatState, activeStreamId: null };
    }
    return { ...chatState };
  },
  getChatMessages: async () => [],
  createChatMessageIfNotExists: async () => undefined,
  updateChat: async () => ({}),
  updateSession: async () => ({}),
  compareAndSetChatActiveStreamId: async (
    chatId: string,
    expected: string | null,
    next: string | null,
  ) => {
    compareAndSetCalls.push({ chatId, expected, next });
    if (stealOwnershipDuringFinalize && next === null) {
      chatState.activeStreamId = "newer-stream-token";
      return false;
    }
    if (chatState.activeStreamId !== expected) {
      return false;
    }
    chatState.activeStreamId = next;
    return true;
  },
  upsertChatMessageScoped: async (input: UpsertScopedInput) => {
    upsertScopedCalls.push(input);
    if (upsertConflict) {
      return { status: "conflict" } as const;
    }
    return { status: "updated", message: { id: input.id } } as const;
  },
}));

const routeModulePromise = import("./route");

describe("/api/chat ownership guards", () => {
  beforeEach(() => {
    nextNanoId = 0;
    getChatByIdCallCount = 0;
    loseOwnershipOnFinish = false;
    stealOwnershipDuringFinalize = false;
    upsertConflict = false;
    upsertScopedCalls.length = 0;
    compareAndSetCalls.length = 0;
    activeStreamAtRegistration.length = 0;
    chatState = {
      id: "chat-1",
      sessionId: "session-1",
      modelId: "test-model",
      activeStreamId: null,
    };
  });

  test("persists assistant snapshot at start and on finish when still owner", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        chatId: "chat-1",
        messages: [
          {
            id: "assistant-live",
            role: "assistant",
            parts: [
              { type: "tool-ask_user_question", state: "input-available" },
            ],
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(upsertScopedCalls.length).toBe(2);
    expect(upsertScopedCalls[0]?.id).toBe("assistant-live");
    expect(upsertScopedCalls[1]?.id).toBe("assistant-final");
    expect(activeStreamAtRegistration[0]).toBeNull();
    expect(compareAndSetCalls[0]?.expected).toBeNull();
    expect(compareAndSetCalls[0]?.next).toContain(":request-token");
  });

  test("skips onFinish assistant upsert when ownership is lost", async () => {
    const { POST } = await routeModulePromise;
    loseOwnershipOnFinish = true;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        chatId: "chat-1",
        messages: [
          {
            id: "assistant-live",
            role: "assistant",
            parts: [
              { type: "tool-ask_user_question", state: "input-available" },
            ],
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(upsertScopedCalls.length).toBe(1);
    expect(upsertScopedCalls[0]?.id).toBe("assistant-live");
    expect(chatState.activeStreamId).toBe("newer-stream-token");
  });

  test("skips onFinish writes when ownership changes during finalize CAS", async () => {
    const { POST } = await routeModulePromise;
    stealOwnershipDuringFinalize = true;

    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        chatId: "chat-1",
        messages: [
          {
            id: "assistant-live",
            role: "assistant",
            parts: [
              { type: "tool-ask_user_question", state: "input-available" },
            ],
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(upsertScopedCalls.length).toBe(1);
    expect(upsertScopedCalls[0]?.id).toBe("assistant-live");
    expect(chatState.activeStreamId).toBe("newer-stream-token");
  });
});
