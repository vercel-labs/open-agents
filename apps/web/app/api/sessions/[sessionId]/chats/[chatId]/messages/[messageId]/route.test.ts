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

type DeleteMessageResult =
  | {
      status: "not_found";
    }
  | {
      status: "not_user_message";
    }
  | {
      status: "deleted";
      deletedMessageIds: string[];
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let currentAuthSession: {
  authProvider?: "vercel" | "github";
  user: {
    id: string;
    email?: string;
  };
} | null = null;
let ownedSessionChatResult: OwnedSessionChatResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
  chat: {
    id: "chat-1",
    sessionId: "session-1",
    activeStreamId: null,
  },
};
let deleteResult: DeleteMessageResult = {
  status: "deleted",
  deletedMessageIds: ["message-2", "message-3"],
};

const deleteCalls: Array<{ chatId: string; messageId: string }> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionChat: async () => ownedSessionChatResult,
}));

let mockWorkflowStatus = "running";

mock.module("@/lib/db/sessions", () => ({
  deleteChatMessageAndFollowing: async (chatId: string, messageId: string) => {
    deleteCalls.push({ chatId, messageId });
    return deleteResult;
  },
  updateChatActiveStreamId: async () => {},
}));

mock.module("workflow/api", () => ({
  getRun: () => ({
    get status() {
      return Promise.resolve(mockWorkflowStatus);
    },
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentAuthSession,
}));

const routeModulePromise = import("./route");

function createContext(
  sessionId = "session-1",
  chatId = "chat-1",
  messageId = "message-2",
) {
  return {
    params: Promise.resolve({ sessionId, chatId, messageId }),
  };
}

describe("/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    currentAuthSession = null;
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        activeStreamId: null,
      },
    };
    deleteResult = {
      status: "deleted",
      deletedMessageIds: ["message-2", "message-3"],
    };
    deleteCalls.length = 0;
    mockWorkflowStatus = "running";
  });

  test("returns auth error from guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(deleteCalls).toHaveLength(0);
  });

  test("returns ownership error from guard", async () => {
    ownedSessionChatResult = {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
  });

  test("returns 403 for hosted users from non-allowed domains", async () => {
    currentAuthSession = {
      authProvider: "vercel",
      user: {
        id: "user-1",
        email: "person@example.com",
      },
    };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "https://open-agents.dev/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "This hosted deployment only supports approved email domains. Deploy your own copy to use Open Agents with your account.",
    );
    expect(deleteCalls).toHaveLength(0);
  });

  test("returns 409 when chat has an active stream", async () => {
    ownedSessionChatResult = {
      ok: true,
      sessionRecord: { id: "session-1" },
      chat: {
        id: "chat-1",
        sessionId: "session-1",
        activeStreamId: "stream-1",
      },
    };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      "Cannot delete messages while a response is streaming",
    );
    expect(deleteCalls).toHaveLength(0);
  });

  test("returns 404 when message is not found", async () => {
    deleteResult = { status: "not_found" };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Message not found");
  });

  test("returns 400 when deleting non-user message", async () => {
    deleteResult = { status: "not_user_message" };
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Only user messages can be deleted");
  });

  test("returns deleted ids on success", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/messages/message-2",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as {
      success: boolean;
      deletedMessageIds: string[];
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      deletedMessageIds: ["message-2", "message-3"],
    });
    expect(deleteCalls).toEqual([{ chatId: "chat-1", messageId: "message-2" }]);
  });
});
