import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

// ── Mutable spy state ──────────────────────────────────────────────

let createChatMessageIfNotExistsResult: unknown = { id: "msg-1" };
let isFirstChatMessageResult = false;
let upsertChatMessageScopedResult: { status: string } = {
  status: "inserted",
};

const spies = {
  compareAndSetChatActiveStreamId: mock(() => Promise.resolve(true)),
  createChatMessageIfNotExists: mock(
    () =>
      Promise.resolve(createChatMessageIfNotExistsResult) as Promise<unknown>,
  ),
  isFirstChatMessage: mock(
    () => Promise.resolve(isFirstChatMessageResult) as Promise<boolean>,
  ),
  touchChat: mock(() => Promise.resolve()),
  updateChat: mock((_chatId: string, _patch: Record<string, unknown>) =>
    Promise.resolve(),
  ),
  updateChatAssistantActivity: mock(() => Promise.resolve()),
  updateSession: mock((_sessionId: string, _patch: Record<string, unknown>) =>
    Promise.resolve(),
  ),
  upsertChatMessageScoped: mock(() =>
    Promise.resolve(upsertChatMessageScopedResult),
  ),
  recordUsage: mock(() => Promise.resolve()),
  buildActiveLifecycleUpdate: mock(() => ({})),
  buildLifecycleActivityUpdate: mock(() => ({})),
  connectSandbox: mock(() =>
    Promise.resolve({
      getState: () => ({ type: "vercel", sandboxId: "sb-1" }),
    }),
  ),
  computeAndCacheDiff: mock(() => Promise.resolve()),
  performAutoCommit: mock(() =>
    Promise.resolve({ committed: true, pushed: true }),
  ),
  performAutoCreatePr: mock(() =>
    Promise.resolve({ created: true, syncedExisting: false, skipped: false }),
  ),
};

// ── Module mocks (must appear before the module-under-test import) ──

mock.module("@/lib/db/sessions", () => ({
  compareAndSetChatActiveStreamId: spies.compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists: spies.createChatMessageIfNotExists,
  isFirstChatMessage: spies.isFirstChatMessage,
  touchChat: spies.touchChat,
  updateChat: spies.updateChat,
  updateChatAssistantActivity: spies.updateChatAssistantActivity,
  updateSession: spies.updateSession,
  upsertChatMessageScoped: spies.upsertChatMessageScoped,
}));

mock.module("@/lib/db/usage", () => ({
  recordUsage: spies.recordUsage,
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildActiveLifecycleUpdate: spies.buildActiveLifecycleUpdate,
  buildLifecycleActivityUpdate: spies.buildLifecycleActivityUpdate,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@/lib/diff/compute-diff", () => ({
  computeAndCacheDiff: spies.computeAndCacheDiff,
}));

mock.module("@/lib/chat/auto-commit-direct", () => ({
  performAutoCommit: spies.performAutoCommit,
}));

mock.module("@/lib/chat/auto-pr-direct", () => ({
  performAutoCreatePr: spies.performAutoCreatePr,
}));

const {
  persistUserMessage,
  persistAssistantMessage,
  refreshLifecycleActivity,
  persistSandboxState,
  clearActiveStream,
  refreshDiffCache,
  runAutoCommitStep,
  runAutoCreatePrStep,
} = await import("./chat-post-finish");

// ── Helpers ────────────────────────────────────────────────────────

function makeUserMessage(
  overrides?: Partial<WebAgentUIMessage>,
): WebAgentUIMessage {
  return {
    id: "msg-1",
    role: "user",
    parts: [{ type: "text", text: "Hello world, this is a test message" }],
    ...overrides,
  } as WebAgentUIMessage;
}

function makeAssistantMessage(
  overrides?: Partial<WebAgentUIMessage>,
): WebAgentUIMessage {
  return {
    id: "msg-2",
    role: "assistant",
    parts: [{ type: "text", text: "Response" }],
    ...overrides,
  } as WebAgentUIMessage;
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  Object.values(spies).forEach((s) => s.mockClear());
  createChatMessageIfNotExistsResult = { id: "msg-1" };
  isFirstChatMessageResult = false;
  upsertChatMessageScopedResult = { status: "inserted" };
});

// ─── persistUserMessage ────────────────────────────────────────────

describe("persistUserMessage", () => {
  test("skips non-user messages", async () => {
    await persistUserMessage("chat-1", makeAssistantMessage());
    expect(spies.createChatMessageIfNotExists).not.toHaveBeenCalled();
  });

  test("creates message and touches chat", async () => {
    await persistUserMessage("chat-1", makeUserMessage());

    expect(spies.createChatMessageIfNotExists).toHaveBeenCalledTimes(1);
    expect(spies.touchChat).toHaveBeenCalledWith("chat-1");
  });

  test("returns early when message already exists", async () => {
    createChatMessageIfNotExistsResult = undefined;
    await persistUserMessage("chat-1", makeUserMessage());

    expect(spies.touchChat).not.toHaveBeenCalled();
  });

  test("sets title when first message with short text", async () => {
    isFirstChatMessageResult = true;
    const msg = makeUserMessage({
      parts: [{ type: "text", text: "Fix bug" }],
    });

    await persistUserMessage("chat-1", msg);

    expect(spies.updateChat).toHaveBeenCalledWith("chat-1", {
      title: "Fix bug",
    });
  });

  test("truncates title when text exceeds 30 chars", async () => {
    isFirstChatMessageResult = true;
    const longText = "A".repeat(50);
    const msg = makeUserMessage({
      parts: [{ type: "text", text: longText }],
    });

    await persistUserMessage("chat-1", msg);

    expect(spies.updateChat).toHaveBeenCalledWith("chat-1", {
      title: `${"A".repeat(30)}...`,
    });
  });

  test("skips title when no text parts", async () => {
    isFirstChatMessageResult = true;
    const msg = makeUserMessage({
      parts: [{ type: "tool-invocation" as unknown as "text", text: "" }],
    });

    await persistUserMessage("chat-1", msg);

    // updateChat should not be called since text extraction yields ""
    expect(spies.updateChat).not.toHaveBeenCalled();
  });

  test("does not throw on db error", async () => {
    spies.createChatMessageIfNotExists.mockImplementationOnce(() =>
      Promise.reject(new Error("DB down")),
    );

    // Should not throw
    await persistUserMessage("chat-1", makeUserMessage());
  });
});

// ─── persistAssistantMessage ───────────────────────────────────────

describe("persistAssistantMessage", () => {
  test("upserts assistant message and updates activity on insert", async () => {
    upsertChatMessageScopedResult = { status: "inserted" };

    await persistAssistantMessage("chat-1", makeAssistantMessage());

    expect(spies.upsertChatMessageScoped).toHaveBeenCalledTimes(1);
    expect(spies.updateChatAssistantActivity).toHaveBeenCalledTimes(1);
  });

  test("skips activity update on conflict", async () => {
    upsertChatMessageScopedResult = { status: "conflict" };

    await persistAssistantMessage("chat-1", makeAssistantMessage());

    expect(spies.upsertChatMessageScoped).toHaveBeenCalledTimes(1);
    expect(spies.updateChatAssistantActivity).not.toHaveBeenCalled();
  });

  test("skips activity update on update status", async () => {
    upsertChatMessageScopedResult = { status: "updated" };

    await persistAssistantMessage("chat-1", makeAssistantMessage());

    expect(spies.updateChatAssistantActivity).not.toHaveBeenCalled();
  });

  test("does not throw on db error", async () => {
    spies.upsertChatMessageScoped.mockImplementationOnce(() =>
      Promise.reject(new Error("DB down")),
    );

    await persistAssistantMessage("chat-1", makeAssistantMessage());
  });
});

// ─── refreshLifecycleActivity ──────────────────────────────────────

describe("refreshLifecycleActivity", () => {
  test("updates session lifecycle timing", async () => {
    await refreshLifecycleActivity("session-1");

    expect(spies.buildLifecycleActivityUpdate).toHaveBeenCalledTimes(1);
    expect(spies.updateSession).toHaveBeenCalledTimes(1);
    expect(spies.updateSession).toHaveBeenCalledWith("session-1", {});
  });

  test("does not throw on update error", async () => {
    spies.updateSession.mockImplementationOnce(() =>
      Promise.reject(new Error("DB down")),
    );

    await refreshLifecycleActivity("session-1");
  });
});

// ─── persistSandboxState ───────────────────────────────────────────

describe("persistSandboxState", () => {
  test("connects to sandbox and updates session", async () => {
    await persistSandboxState("session-1", { type: "vercel" } as never);

    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.updateSession).toHaveBeenCalledTimes(1);
  });

  test("skips update when getState returns undefined", async () => {
    spies.connectSandbox.mockImplementationOnce(
      () => Promise.resolve({ getState: () => undefined }) as never,
    );

    await persistSandboxState("session-1", { type: "vercel" } as never);

    expect(spies.updateSession).not.toHaveBeenCalled();
  });

  test("does not throw on connection error", async () => {
    spies.connectSandbox.mockImplementationOnce(() =>
      Promise.reject(new Error("Sandbox unavailable")),
    );

    await persistSandboxState("session-1", { type: "vercel" } as never);
  });
});

// ─── clearActiveStream ─────────────────────────────────────────────

describe("clearActiveStream", () => {
  test("calls compareAndSet with correct args", async () => {
    await clearActiveStream("chat-1", "wrun_abc");

    expect(spies.compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "wrun_abc",
      null,
    );
  });

  test("retries transient db errors before succeeding", async () => {
    spies.compareAndSetChatActiveStreamId
      .mockImplementationOnce(() => Promise.reject(new Error("DB down")))
      .mockImplementationOnce(() => Promise.reject(new Error("DB still down")));

    await clearActiveStream("chat-1", "wrun_abc");

    expect(spies.compareAndSetChatActiveStreamId).toHaveBeenCalledTimes(3);

    const compareAndSetCalls = spies.compareAndSetChatActiveStreamId.mock
      .calls as unknown[][];
    expect(compareAndSetCalls).toEqual([
      ["chat-1", "wrun_abc", null],
      ["chat-1", "wrun_abc", null],
      ["chat-1", "wrun_abc", null],
    ]);
  });

  test("does not throw after retry budget is exhausted", async () => {
    spies.compareAndSetChatActiveStreamId
      .mockImplementationOnce(() => Promise.reject(new Error("DB down")))
      .mockImplementationOnce(() => Promise.reject(new Error("DB still down")))
      .mockImplementationOnce(() =>
        Promise.reject(new Error("DB really down")),
      );

    await clearActiveStream("chat-1", "wrun_abc");

    expect(spies.compareAndSetChatActiveStreamId).toHaveBeenCalledTimes(3);
  });
});

// ─── refreshDiffCache ──────────────────────────────────────────────

describe("refreshDiffCache", () => {
  test("connects sandbox and computes diff", async () => {
    await refreshDiffCache("session-1", { type: "vercel" } as never);

    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.computeAndCacheDiff).toHaveBeenCalledTimes(1);
  });

  test("does not throw on error", async () => {
    spies.connectSandbox.mockImplementationOnce(() =>
      Promise.reject(new Error("Sandbox unavailable")),
    );

    await refreshDiffCache("session-1", { type: "vercel" } as never);
  });
});

// ─── runAutoCommitStep ─────────────────────────────────────────────

describe("runAutoCommitStep", () => {
  test("connects sandbox and performs auto-commit", async () => {
    await runAutoCommitStep({
      userId: "user-1",
      sessionId: "session-1",
      sessionTitle: "My session",
      repoOwner: "acme",
      repoName: "repo",
      sandboxState: { type: "vercel" } as never,
    });

    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.performAutoCommit).toHaveBeenCalledTimes(1);
    expect(spies.performAutoCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        sessionTitle: "My session",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );
  });

  test("does not throw on error", async () => {
    spies.performAutoCommit.mockImplementationOnce(() =>
      Promise.reject(new Error("Git error")),
    );

    await runAutoCommitStep({
      userId: "user-1",
      sessionId: "session-1",
      sessionTitle: "My session",
      repoOwner: "acme",
      repoName: "repo",
      sandboxState: { type: "vercel" } as never,
    });
  });
});

describe("runAutoCreatePrStep", () => {
  test("connects sandbox and performs auto PR creation", async () => {
    await runAutoCreatePrStep({
      userId: "user-1",
      sessionId: "session-1",
      sessionTitle: "My session",
      repoOwner: "acme",
      repoName: "repo",
      sandboxState: { type: "vercel" } as never,
    });

    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.performAutoCreatePr).toHaveBeenCalledTimes(1);
    expect(spies.performAutoCreatePr).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        sessionTitle: "My session",
        repoOwner: "acme",
        repoName: "repo",
      }),
    );
  });

  test("does not throw on error", async () => {
    spies.performAutoCreatePr.mockImplementationOnce(() =>
      Promise.reject(new Error("GitHub error")),
    );

    await runAutoCreatePrStep({
      userId: "user-1",
      sessionId: "session-1",
      sessionTitle: "My session",
      repoOwner: "acme",
      repoName: "repo",
      sandboxState: { type: "vercel" } as never,
    });
  });
});
