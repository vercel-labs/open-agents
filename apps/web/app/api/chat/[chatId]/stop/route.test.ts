import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// ── Mutable state ──────────────────────────────────────────────────

let currentAuthSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

let chatRecord: {
  sessionId: string;
  activeStreamId: string | null;
} | null = {
  sessionId: "session-1",
  activeStreamId: "wrun_active-123",
};

let sessionRecord: {
  id: string;
  userId: string;
} | null = {
  id: "session-1",
  userId: "user-1",
};

let cancelShouldThrow = false;

const spies = {
  cancel: mock(() => {
    if (cancelShouldThrow) throw new Error("Cancel failed");
    return Promise.resolve();
  }),
  compareAndSetChatActiveStreamId: mock(() => Promise.resolve(true)),
  createChatMessageIfNotExists: mock(
    () => Promise.resolve({ id: "msg-1" }) as Promise<unknown>,
  ),
  updateChatAssistantActivity: mock(() => Promise.resolve()),
};

// ── Module mocks ───────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch;

mock.module("workflow/api", () => ({
  getRun: () => ({
    cancel: spies.cancel,
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentAuthSession,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => chatRecord,
  getSessionById: async () => sessionRecord,
  compareAndSetChatActiveStreamId: spies.compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists: spies.createChatMessageIfNotExists,
  updateChatAssistantActivity: spies.updateChatAssistantActivity,
}));

const routeModulePromise = import("./route");

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ── Helpers ────────────────────────────────────────────────────────

function createStopRequest(body?: unknown) {
  return new Request("http://localhost/api/chat/chat-1/stop", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "session=abc",
    },
    body: body !== undefined ? JSON.stringify(body) : "{}",
  });
}

const routeContext = {
  params: Promise.resolve({ chatId: "chat-1" }),
};

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  currentAuthSession = { user: { id: "user-1" } };
  sessionRecord = { id: "session-1", userId: "user-1" };
  chatRecord = {
    sessionId: "session-1",
    activeStreamId: "wrun_active-123",
  };
  cancelShouldThrow = false;
  Object.values(spies).forEach((s) => s.mockClear());
});

describe("POST /api/chat/[chatId]/stop", () => {
  test("returns 401 when not authenticated", async () => {
    currentAuthSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createStopRequest(), routeContext);
    expect(response.status).toBe(401);
  });

  test("returns 404 when chat not found", async () => {
    chatRecord = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createStopRequest(), routeContext);
    expect(response.status).toBe(404);
  });

  test("returns 403 when session not owned by user", async () => {
    sessionRecord = { id: "session-1", userId: "user-2" };
    const { POST } = await routeModulePromise;

    const response = await POST(createStopRequest(), routeContext);
    expect(response.status).toBe(403);
  });

  test("returns success immediately when no active stream", async () => {
    chatRecord = { sessionId: "session-1", activeStreamId: null };
    const { POST } = await routeModulePromise;

    const response = await POST(createStopRequest(), routeContext);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ success: true });

    // Should not attempt cancel or CAS
    expect(spies.cancel).not.toHaveBeenCalled();
    expect(spies.compareAndSetChatActiveStreamId).not.toHaveBeenCalled();
  });

  test("cancels workflow and clears activeStreamId on success", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createStopRequest(), routeContext);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ success: true });

    expect(spies.cancel).toHaveBeenCalledTimes(1);
    expect(spies.compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "wrun_active-123",
      null,
    );
  });

  test("returns 500 when workflow cancel fails", async () => {
    cancelShouldThrow = true;
    const { POST } = await routeModulePromise;

    const response = await POST(createStopRequest(), routeContext);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toEqual({ error: "Failed to cancel workflow run" });
  });

  test("persists assistant snapshot when valid message in body", async () => {
    const { POST } = await routeModulePromise;

    const body = {
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Partial response..." }],
      },
    };

    await POST(createStopRequest(body), routeContext);

    expect(spies.createChatMessageIfNotExists).toHaveBeenCalledTimes(1);
    expect(spies.createChatMessageIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "assistant-1",
        chatId: "chat-1",
        role: "assistant",
      }),
    );
  });

  test("skips snapshot when body has no assistant message", async () => {
    const { POST } = await routeModulePromise;

    await POST(createStopRequest({}), routeContext);

    expect(spies.createChatMessageIfNotExists).not.toHaveBeenCalled();
  });

  test("skips snapshot when body has invalid assistant message", async () => {
    const { POST } = await routeModulePromise;

    const body = {
      assistantMessage: { id: "x", role: "user", parts: [] },
    };

    await POST(createStopRequest(body), routeContext);

    expect(spies.createChatMessageIfNotExists).not.toHaveBeenCalled();
  });

  test("updates assistant activity when snapshot is created", async () => {
    const { POST } = await routeModulePromise;

    const body = {
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Partial" }],
      },
    };

    await POST(createStopRequest(body), routeContext);

    expect(spies.updateChatAssistantActivity).toHaveBeenCalledTimes(1);
  });

  test("skips activity update when snapshot already exists", async () => {
    spies.createChatMessageIfNotExists.mockImplementationOnce(() =>
      Promise.resolve(undefined),
    );

    const { POST } = await routeModulePromise;

    const body = {
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Partial" }],
      },
    };

    await POST(createStopRequest(body), routeContext);

    expect(spies.updateChatAssistantActivity).not.toHaveBeenCalled();
  });

  test("proceeds with cancel even if snapshot persistence fails", async () => {
    spies.createChatMessageIfNotExists.mockImplementationOnce(() =>
      Promise.reject(new Error("DB down")),
    );

    const { POST } = await routeModulePromise;

    const body = {
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Partial" }],
      },
    };

    const response = await POST(createStopRequest(body), routeContext);
    expect(response.status).toBe(200);
    expect(spies.cancel).toHaveBeenCalledTimes(1);
  });
});
