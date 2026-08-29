import { beforeEach, describe, expect, mock, test } from "bun:test";

type TestHarnessId = "open-agent" | "codex" | "claude-code" | "pi";

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionChatResult =
  | {
      ok: true;
      sessionRecord: { id: string };
      chat: {
        id: string;
        sessionId: string;
        modelId: string;
        harnessId: TestHarnessId;
        activeStreamId: string | null;
      };
    }
  | {
      ok: false;
      response: Response;
    };

type ChatMessageRecord = {
  id: string;
  parts: Array<{ type: string; text?: string }>;
};

type ChatRecord = {
  id: string;
  sessionId: string;
  title: string;
  modelId: string;
  harnessId: TestHarnessId;
};

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionChatResult: OwnedSessionChatResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
  chat: {
    id: "chat-1",
    sessionId: "session-1",
    modelId: "model-1",
    harnessId: "open-agent",
    activeStreamId: null,
  },
};
let currentSession: {
  authProvider?: "vercel" | "github";
  user: { id: string; email?: string; username?: string; avatar?: string };
} | null = {
  user: { id: "user-1" },
};
let chatMessages: ChatMessageRecord[] = [
  {
    id: "message-1",
    parts: [{ type: "text", text: "Hello" }],
  },
];

let updatedChat: ChatRecord | null = {
  id: "chat-1",
  sessionId: "session-1",
  title: "Updated",
  modelId: "model-updated",
  harnessId: "open-agent",
};
let chatsInSession: Array<{ id: string }> = [
  { id: "chat-1" },
  { id: "chat-2" },
];

const updateChatCalls: Array<{
  chatId: string;
  patch: {
    title?: string;
    modelId?: string;
    harnessId?: TestHarnessId;
  };
}> = [];
const updateEmptyChatCalls: Array<{
  chatId: string;
  patch: {
    title?: string;
    modelId?: string;
    harnessId?: TestHarnessId;
  };
}> = [];
let updatedEmptyChat: ChatRecord | null = null;
const deleteChatCalls: string[] = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ownedSessionChatResult,
}));

mock.module("@/lib/db/sessions", () => ({
  updateChat: async (
    chatId: string,
    patch: {
      title?: string;
      modelId?: string;
      harnessId?: TestHarnessId;
    },
  ) => {
    updateChatCalls.push({ chatId, patch });
    return updatedChat;
  },
  updateEmptyChat: async (
    chatId: string,
    patch: {
      title?: string;
      modelId?: string;
      harnessId?: TestHarnessId;
    },
  ) => {
    updateEmptyChatCalls.push({ chatId, patch });
    return updatedEmptyChat;
  },
  getChatMessages: async () => chatMessages,
  getChatsBySessionId: async () => chatsInSession,
  deleteChat: async (chatId: string) => {
    deleteChatCalls.push(chatId);
  },
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "model-default",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: true,
    alertSoundEnabled: true,
    publicUsageEnabled: false,
    globalSkillRefs: [],
    modelVariants: [],
    enabledModelIds: [],
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1", chatId = "chat-1") {
  return {
    params: Promise.resolve({ sessionId, chatId }),
  };
}

function createGetRequest(): Request {
  return new Request("http://localhost/api/sessions/session-1/chats/chat-1");
}

function createPatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions/[sessionId]/chats/[chatId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        harnessId: "open-agent",
        activeStreamId: null,
      },
    };
    currentSession = { user: { id: "user-1" } };
    chatMessages = [
      {
        id: "message-1",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    updatedChat = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Updated",
      modelId: "model-updated",
      harnessId: "open-agent",
    };
    updatedEmptyChat = null;
    chatsInSession = [{ id: "chat-1" }, { id: "chat-2" }];
    updateChatCalls.length = 0;
    updateEmptyChatCalls.length = 0;
    deleteChatCalls.length = 0;
  });

  test("GET returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(createGetRequest(), createContext());

    expect(response.status).toBe(401);
  });

  test("GET returns the latest chat snapshot", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        harnessId: "open-agent",
        activeStreamId: "stream-1",
      },
    };
    chatMessages = [
      {
        id: "message-1",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "message-2",
        parts: [{ type: "text", text: "World" }],
      },
    ];
    const { GET } = await routeModulePromise;

    const response = await GET(createGetRequest(), createContext());
    const body = (await response.json()) as {
      chat: {
        id: string;
        modelId: string;
        harnessId: "open-agent";
        activeStreamId: string | null;
      };
      isStreaming: boolean;
      messages: ChatMessageRecord["parts"][];
    };

    expect(response.status).toBe(200);
    expect(body.chat).toEqual({
      id: "chat-1",
      modelId: "model-1",
      harnessId: "open-agent",
      activeStreamId: "stream-1",
    });
    expect(body.isStreaming).toBe(true);
    expect(body.messages).toEqual(chatMessages.map((message) => message.parts));
  });

  test("PATCH returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "x" }),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH returns ownership error from guard", async () => {
    ownedSessionChatResult = {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "x" }),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH returns 400 for invalid JSON", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });

  test("PATCH returns 400 when neither title nor modelId is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "   " }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("At least one field is required");
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH trims fields and updates chat", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "  New title  ", modelId: "  model-2  " }),
      createContext(),
    );
    const body = (await response.json()) as { chat: ChatRecord };

    expect(response.status).toBe(200);
    expect(updateChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: { title: "New title", modelId: "model-2" },
      },
    ]);
    expect(body.chat.id).toBe("chat-1");
  });

  test("PATCH returns 404 when updateChat returns null", async () => {
    updatedChat = null;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ title: "New" }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Chat not found");
  });

  test("PATCH rejects an invalid harness", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ harnessId: "unknown" }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid harness");
    expect(updateChatCalls).toHaveLength(0);
    expect(updateEmptyChatCalls).toHaveLength(0);
  });

  test("PATCH switches an empty chat to the claude-code harness", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        harnessId: "codex",
        activeStreamId: null,
      },
    };
    updatedEmptyChat = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Chat",
      modelId: "model-1",
      harnessId: "claude-code",
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ harnessId: "claude-code" }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateEmptyChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: {
          harnessId: "claude-code",
          modelId: "anthropic/claude-haiku-4.5",
        },
      },
    ]);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH keeps a native-provider model when switching harness", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "anthropic/claude-haiku-4.5",
        harnessId: "open-agent",
        activeStreamId: null,
      },
    };
    updatedEmptyChat = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Chat",
      modelId: "anthropic/claude-haiku-4.5",
      harnessId: "claude-code",
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ harnessId: "claude-code" }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateEmptyChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: { harnessId: "claude-code" },
      },
    ]);
  });

  test("PATCH switches an empty chat to the pi harness", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        harnessId: "open-agent",
        activeStreamId: null,
      },
    };
    updatedEmptyChat = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Chat",
      modelId: "model-1",
      harnessId: "pi",
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ harnessId: "pi" }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateEmptyChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: { harnessId: "pi" },
      },
    ]);
  });

  test("PATCH updates an empty chat harness atomically with other fields", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        harnessId: "codex",
        activeStreamId: null,
      },
    };
    updatedEmptyChat = {
      id: "chat-1",
      sessionId: "session-1",
      title: "New title",
      modelId: "model-updated",
      harnessId: "open-agent",
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({
        title: "  New title  ",
        modelId: "  model-2  ",
        harnessId: "open-agent",
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(updateEmptyChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: {
          title: "New title",
          modelId: "model-2",
          harnessId: "open-agent",
        },
      },
    ]);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("PATCH rejects changing the harness after the first message", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        modelId: "model-1",
        harnessId: "codex",
        activeStreamId: null,
      },
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createPatchRequest({ harnessId: "open-agent" }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      "Harness cannot be changed after the first message",
    );
    expect(updateEmptyChatCalls).toEqual([
      {
        chatId: "chat-1",
        patch: { harnessId: "open-agent" },
      },
    ]);
    expect(updateChatCalls).toHaveLength(0);
  });

  test("DELETE returns 400 when attempting to delete the only chat", async () => {
    chatsInSession = [{ id: "chat-1" }];
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
        method: "DELETE",
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Cannot delete the only chat in a session");
    expect(deleteChatCalls).toHaveLength(0);
  });

  test("DELETE removes chat when more than one chat exists", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1", {
        method: "DELETE",
      }),
      createContext(),
    );
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteChatCalls).toEqual(["chat-1"]);
  });
});
