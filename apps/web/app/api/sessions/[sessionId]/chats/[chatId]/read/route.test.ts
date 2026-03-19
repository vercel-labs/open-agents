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

type OwnedSessionChatResult =
  | {
      ok: true;
      sessionRecord: { id: string };
      chat: { id: string; sessionId: string };
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionChatResult: OwnedSessionChatResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
  chat: { id: "chat-1", sessionId: "session-1" },
};

const markChatReadCalls: Array<{ userId: string; chatId: string }> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ownedSessionChatResult,
}));

mock.module("@/lib/db/sessions", () => ({
  markChatRead: async (input: { userId: string; chatId: string }) => {
    markChatReadCalls.push(input);
  },
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1", chatId = "chat-1") {
  return {
    params: Promise.resolve({ sessionId, chatId }),
  };
}

describe("/api/sessions/[sessionId]/chats/[chatId]/read", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: { id: "chat-1", sessionId: "session-1" },
    };
    markChatReadCalls.length = 0;
  });

  test("returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/read", {
        method: "POST",
      }),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(markChatReadCalls).toHaveLength(0);
  });

  test("returns ownership error from guard", async () => {
    ownedSessionChatResult = {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/read", {
        method: "POST",
      }),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(markChatReadCalls).toHaveLength(0);
  });

  test("marks chat as read when auth and ownership checks pass", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/read", {
        method: "POST",
      }),
      createContext(),
    );
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(markChatReadCalls).toEqual([{ userId: "user-1", chatId: "chat-1" }]);
  });
});
