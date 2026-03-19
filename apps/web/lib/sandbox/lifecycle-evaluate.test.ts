import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface TestSessionRecord {
  id: string;
  status: "running" | "completed" | "failed" | "archived";
  lifecycleState:
    | "provisioning"
    | "active"
    | "hibernating"
    | "hibernated"
    | "restoring"
    | "archived"
    | "failed";
  sandboxState: {
    type: "vercel";
    sandboxId: string;
  };
  hibernateAfter: Date | null;
  lastActivityAt: Date | null;
  sandboxExpiresAt: Date | null;
  updatedAt: Date;
}

let runStatus: RunStatus = "running";
let shouldThrowWhenLoadingRun = false;
let sessionRecord: TestSessionRecord | null = null;
let chatsInSession: Array<{ id: string; activeStreamId: string | null }> = [];
let snapshotId = "snapshot-1";
let snapshotError: Error | null = null;

const spies = {
  getRun: mock((runId: string) => {
    if (shouldThrowWhenLoadingRun) {
      throw new Error(`missing run ${runId}`);
    }

    return {
      status: Promise.resolve(runStatus),
    };
  }),
  compareAndSetChatActiveStreamId: mock(
    (_chatId: string, _expectedStreamId: string | null, _nextStreamId: null) =>
      Promise.resolve(true),
  ),
  getChatsBySessionId: mock(
    async (_sessionId: string) => chatsInSession as never,
  ),
  getSessionById: mock(async (_sessionId: string) => sessionRecord as never),
  updateSession: mock(
    async (_sessionId: string, patch: Record<string, unknown>) => patch,
  ),
  connectSandbox: mock(async () => ({
    snapshot: async () => {
      if (snapshotError) {
        throw snapshotError;
      }
      return { snapshotId };
    },
  })),
};

mock.module("workflow/api", () => ({
  getRun: spies.getRun,
}));

mock.module("@/lib/db/sessions", () => ({
  compareAndSetChatActiveStreamId: spies.compareAndSetChatActiveStreamId,
  getChatsBySessionId: spies.getChatsBySessionId,
  getSessionById: spies.getSessionById,
  updateSession: spies.updateSession,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

const { evaluateSandboxLifecycle } = await import("./lifecycle");

function makeDueSession(): TestSessionRecord {
  const nowMs = Date.now();

  return {
    id: "session-1",
    status: "running",
    lifecycleState: "active",
    sandboxState: {
      type: "vercel",
      sandboxId: "sandbox-1",
    },
    hibernateAfter: new Date(nowMs - 1_000),
    lastActivityAt: new Date(nowMs - 60_000),
    sandboxExpiresAt: null,
    updatedAt: new Date(nowMs - 60_000),
  };
}

beforeEach(() => {
  runStatus = "running";
  shouldThrowWhenLoadingRun = false;
  sessionRecord = makeDueSession();
  chatsInSession = [];
  snapshotId = "snapshot-1";
  snapshotError = null;

  Object.values(spies).forEach((spy) => spy.mockClear());
});

describe("evaluateSandboxLifecycle", () => {
  test("skips hibernation when a chat workflow is actively running", async () => {
    chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-running-1" }];
    runStatus = "running";

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.connectSandbox).not.toHaveBeenCalled();
    expect(spies.updateSession).not.toHaveBeenCalled();
    expect(spies.compareAndSetChatActiveStreamId).not.toHaveBeenCalled();
  });

  test("skips hibernation when workflow status cannot be read", async () => {
    chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-unknown-1" }];
    shouldThrowWhenLoadingRun = true;

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.connectSandbox).not.toHaveBeenCalled();
    expect(spies.updateSession).not.toHaveBeenCalled();
    expect(spies.compareAndSetChatActiveStreamId).not.toHaveBeenCalled();
  });

  test("does not extend lifecycle timers when snapshot is already in progress", async () => {
    snapshotError = new Error(
      "422 sandbox_snapshotting: creating a snapshot and will be stopped shortly",
    );

    const originalHibernateAfterMs = sessionRecord?.hibernateAfter?.getTime();
    const originalLastActivityAtMs = sessionRecord?.lastActivityAt?.getTime();

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({
      action: "skipped",
      reason: "snapshot-already-in-progress",
    });

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch.lifecycleState).toBe("hibernating");
    expect(finalPatch).toEqual({
      lifecycleState: "active",
      lifecycleError: null,
      sandboxExpiresAt: null,
    });
    expect(finalPatch).not.toHaveProperty("lastActivityAt");
    expect(finalPatch).not.toHaveProperty("hibernateAfter");

    expect(sessionRecord?.hibernateAfter?.getTime()).toBe(
      originalHibernateAfterMs,
    );
    expect(sessionRecord?.lastActivityAt?.getTime()).toBe(
      originalLastActivityAtMs,
    );
  });

  test("clears terminal stream ids before hibernating", async () => {
    chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-complete-1" }];
    runStatus = "completed";

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "hibernated" });
    expect(spies.compareAndSetChatActiveStreamId).toHaveBeenCalledWith(
      "chat-1",
      "wrun-complete-1",
      null,
    );
    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch.lifecycleState).toBe("hibernating");
    expect(finalPatch.lifecycleState).toBe("hibernated");
    expect(finalPatch.snapshotUrl).toBe("snapshot-1");
  });
});
