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
      chat: { id: string; sessionId: string; activeStreamId: string | null };
    }
  | {
      ok: false;
      response: Response;
    };

type UpsertResult =
  | { status: "inserted"; message: { id: string } }
  | { status: "updated"; message: { id: string } }
  | { status: "conflict" };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionChatResult: OwnedSessionChatResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
  chat: {
    id: "chat-1",
    sessionId: "session-1",
    activeStreamId: null,
  },
};
let upsertResult: UpsertResult = {
  status: "inserted",
  message: { id: "assistant-git-1" },
};

const upsertCalls: Array<{
  id: string;
  chatId: string;
  role: string;
  parts: unknown;
}> = [];
const assistantActivityCalls: Array<{ chatId: string }> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ownedSessionChatResult,
}));

mock.module("@/lib/db/sessions", () => ({
  upsertChatMessageScoped: async (payload: {
    id: string;
    chatId: string;
    role: string;
    parts: unknown;
  }) => {
    upsertCalls.push(payload);
    return upsertResult;
  },
  updateChatAssistantActivity: async (chatId: string) => {
    assistantActivityCalls.push({ chatId });
  },
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1", chatId = "chat-1") {
  return {
    params: Promise.resolve({ sessionId, chatId }),
  };
}

function createPostRequest(body: unknown): Request {
  return new Request(
    "http://localhost/api/sessions/session-1/chats/chat-1/messages",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("/api/sessions/[sessionId]/chats/[chatId]/messages", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        activeStreamId: null,
      },
    };
    upsertResult = {
      status: "inserted",
      message: { id: "assistant-git-1" },
    };
    upsertCalls.length = 0;
    assistantActivityCalls.length = 0;
  });

  test("returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createPostRequest({
        message: { id: "assistant-1", role: "assistant", parts: [] },
      }),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  test("returns ownership error from guard", async () => {
    ownedSessionChatResult = {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createPostRequest({
        message: { id: "assistant-1", role: "assistant", parts: [] },
      }),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(upsertCalls).toHaveLength(0);
  });

  test("returns 400 for invalid assistant message payload", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createPostRequest({
        message: { id: "user-1", role: "user", parts: [] },
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("A valid assistant message is required");
    expect(upsertCalls).toHaveLength(0);
  });

  test("returns 409 for scoped upsert conflict", async () => {
    upsertResult = { status: "conflict" };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createPostRequest({
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "data-commit",
              id: "assistant-1:commit",
              data: { status: "pending" },
            },
          ],
        },
      }),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      "Message ID already belongs to a different chat or role",
    );
  });

  test("persists the assistant message and marks assistant activity on insert", async () => {
    const { POST } = await routeModulePromise;

    const message = {
      id: "assistant-1",
      role: "assistant",
      metadata: {},
      parts: [
        {
          type: "data-commit",
          id: "assistant-1:commit",
          data: {
            status: "success",
            committed: true,
            pushed: true,
            commitSha: "abc123",
            url: "https://github.com/acme/repo/commit/abc123",
          },
        },
      ],
    };

    const response = await POST(
      createPostRequest({ message }),
      createContext(),
    );
    const body = (await response.json()) as {
      success: boolean;
      status: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, status: "inserted" });
    expect(upsertCalls).toEqual([
      {
        id: "assistant-1",
        chatId: "chat-1",
        role: "assistant",
        parts: message,
      },
    ]);
    expect(assistantActivityCalls).toEqual([{ chatId: "chat-1" }]);
  });

  test("does not update assistant activity when only updating an existing message", async () => {
    upsertResult = {
      status: "updated",
      message: { id: "assistant-1" },
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createPostRequest({
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "data-pr",
              id: "assistant-1:pr",
              data: {
                status: "success",
                prNumber: 42,
                url: "https://github.com/acme/repo/pull/42",
              },
            },
          ],
        },
      }),
      createContext(),
    );
    const body = (await response.json()) as {
      success: boolean;
      status: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, status: "updated" });
    expect(assistantActivityCalls).toHaveLength(0);
  });
});
