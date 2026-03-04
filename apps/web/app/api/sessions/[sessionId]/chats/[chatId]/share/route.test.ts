import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthSession = { user: { id: string } } | null;

type SessionRecord = { id: string; userId: string } | null;
type ChatRecord = { id: string; sessionId: string } | null;
type ShareRecord = { id: string; chatId: string } | null;

let currentSession: AuthSession = { user: { id: "user-1" } };
let sessionRecord: SessionRecord = { id: "session-1", userId: "user-1" };
let chatRecord: ChatRecord = { id: "chat-1", sessionId: "session-1" };
let shareRecord: ShareRecord = null;
let createdShareRecord: ShareRecord = { id: "share-new", chatId: "chat-1" };

const createShareInputs: Array<{ id: string; chatId: string }> = [];
const deletedShareChatIds: string[] = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("nanoid", () => ({
  nanoid: () => "generated-share-id",
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
  getChatById: async () => chatRecord,
  getShareByChatId: async () => shareRecord,
  createShareIfNotExists: async (input: { id: string; chatId: string }) => {
    createShareInputs.push(input);
    return createdShareRecord;
  },
  deleteShareByChatId: async (chatId: string) => {
    deletedShareChatIds.push(chatId);
  },
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1", chatId = "chat-1") {
  return {
    params: Promise.resolve({ sessionId, chatId }),
  };
}

describe("/api/sessions/[sessionId]/chats/[chatId]/share", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    sessionRecord = { id: "session-1", userId: "user-1" };
    chatRecord = { id: "chat-1", sessionId: "session-1" };
    shareRecord = null;
    createdShareRecord = { id: "share-new", chatId: "chat-1" };
    createShareInputs.length = 0;
    deletedShareChatIds.length = 0;
  });

  test("GET returns current chat share id", async () => {
    shareRecord = { id: "share-1", chatId: "chat-1" };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/share"),
      createContext(),
    );
    const body = (await response.json()) as { shareId: string | null };

    expect(response.status).toBe(200);
    expect(body.shareId).toBe("share-1");
  });

  test("POST creates a new share when one does not exist", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/share",
        {
          method: "POST",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { shareId: string };

    expect(response.status).toBe(200);
    expect(body.shareId).toBe("share-new");
    expect(createShareInputs).toEqual([
      { id: "generated-share-id", chatId: "chat-1" },
    ]);
  });

  test("POST reuses existing share id when one already exists", async () => {
    shareRecord = { id: "share-existing", chatId: "chat-1" };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/share",
        {
          method: "POST",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { shareId: string };

    expect(response.status).toBe(200);
    expect(body.shareId).toBe("share-existing");
    expect(createShareInputs).toEqual([]);
  });

  test("DELETE revokes share for the chat", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/share",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deletedShareChatIds).toEqual(["chat-1"]);
  });

  test("returns 401 when user is not authenticated", async () => {
    currentSession = null;
    const { GET, POST, DELETE } = await routeModulePromise;

    const getResponse = await GET(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/share"),
      createContext(),
    );
    expect(getResponse.status).toBe(401);

    const postResponse = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/share",
        {
          method: "POST",
        },
      ),
      createContext(),
    );
    expect(postResponse.status).toBe(401);

    const deleteResponse = await DELETE(
      new Request(
        "http://localhost/api/sessions/session-1/chats/chat-1/share",
        {
          method: "DELETE",
        },
      ),
      createContext(),
    );
    expect(deleteResponse.status).toBe(401);
  });

  test("returns 403 when session does not belong to current user", async () => {
    sessionRecord = { id: "session-1", userId: "different-user" };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/share"),
      createContext(),
    );

    expect(response.status).toBe(403);
  });

  test("returns 404 when chat does not belong to the session", async () => {
    chatRecord = { id: "chat-1", sessionId: "session-2" };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/chats/chat-1/share"),
      createContext(),
    );

    expect(response.status).toBe(404);
  });
});
