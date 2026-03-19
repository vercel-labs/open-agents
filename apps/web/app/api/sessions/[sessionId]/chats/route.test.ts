import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionResult =
  | {
      ok: true;
      sessionRecord: { id: string };
    }
  | {
      ok: false;
      response: Response;
    };

type ChatSummary = {
  id: string;
  title: string;
};

type ChatRecord = {
  id: string;
  sessionId: string;
  title: string;
  modelId: string;
};

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionResult: OwnedSessionResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
};

let chatSummaries: ChatSummary[] = [{ id: "chat-1", title: "Chat 1" }];
let existingChat: ChatRecord | null = null;
let createdChat: ChatRecord = {
  id: "generated-chat-id",
  sessionId: "session-1",
  title: "New chat",
  modelId: "model-default",
};

const getSummaryCalls: Array<{ sessionId: string; userId: string }> = [];
const createChatCalls: Array<{
  id: string;
  sessionId: string;
  title: string;
  modelId: string;
}> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSession: async () => ownedSessionResult,
}));

mock.module("nanoid", () => ({
  nanoid: () => "generated-chat-id",
}));

mock.module("@/lib/db/sessions", () => ({
  getChatSummariesBySessionId: async (sessionId: string, userId: string) => {
    getSummaryCalls.push({ sessionId, userId });
    return chatSummaries;
  },
  getChatById: async () => existingChat,
  createChat: async (input: {
    id: string;
    sessionId: string;
    title: string;
    modelId: string;
  }) => {
    createChatCalls.push(input);
    return createdChat;
  },
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({ defaultModelId: "model-default" }),
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions/session-1/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions/[sessionId]/chats", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
    };
    chatSummaries = [{ id: "chat-1", title: "Chat 1" }];
    existingChat = null;
    createdChat = {
      id: "generated-chat-id",
      sessionId: "session-1",
      title: "New chat",
      modelId: "model-default",
    };
    getSummaryCalls.length = 0;
    createChatCalls.length = 0;
  });

  test("GET returns auth error from session guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/chats"),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(getSummaryCalls).toHaveLength(0);
  });

  test("GET returns ownership error from session guard", async () => {
    ownedSessionResult = {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/chats"),
      createContext(),
    );

    expect(response.status).toBe(403);
    expect(getSummaryCalls).toHaveLength(0);
  });

  test("GET returns chats and default model id", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/chats"),
      createContext(),
    );
    const body = (await response.json()) as {
      chats: ChatSummary[];
      defaultModelId: string;
    };

    expect(response.status).toBe(200);
    expect(body.chats).toEqual(chatSummaries);
    expect(body.defaultModelId).toBe("model-default");
    expect(getSummaryCalls).toEqual([
      { sessionId: "session-1", userId: "user-1" },
    ]);
  });

  test("POST returns 400 when provided chat id is invalid", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ id: "" }), createContext());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid chat id");
    expect(createChatCalls).toHaveLength(0);
  });

  test("POST returns existing chat when requested id already exists in session", async () => {
    existingChat = {
      id: "chat-existing",
      sessionId: "session-1",
      title: "Existing",
      modelId: "model-existing",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ id: "chat-existing" }),
      createContext(),
    );
    const body = (await response.json()) as { chat: ChatRecord };

    expect(response.status).toBe(200);
    expect(body.chat.id).toBe("chat-existing");
    expect(createChatCalls).toHaveLength(0);
  });

  test("POST returns 409 when requested id exists in another session", async () => {
    existingChat = {
      id: "chat-existing",
      sessionId: "session-2",
      title: "Elsewhere",
      modelId: "model-existing",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ id: "chat-existing" }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Chat ID conflict");
    expect(createChatCalls).toHaveLength(0);
  });

  test("POST creates a new chat when no id conflict exists", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({}),
      createContext("session-abc"),
    );
    const body = (await response.json()) as { chat: ChatRecord };

    expect(response.status).toBe(200);
    expect(createChatCalls).toEqual([
      {
        id: "generated-chat-id",
        sessionId: "session-abc",
        title: "New chat",
        modelId: "model-default",
      },
    ]);
    expect(body.chat.id).toBe("generated-chat-id");
  });
});
