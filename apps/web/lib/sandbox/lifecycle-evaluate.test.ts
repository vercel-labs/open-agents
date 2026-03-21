import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

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

let sessionRecord: TestSessionRecord | null = null;
let chatsInSession: Array<{ id: string; activeStreamId: string | null }> = [];
let snapshotId = "snapshot-1";
let snapshotError: Error | null = null;

const snapshotSpy = mock(async () => {
  if (snapshotError) {
    throw snapshotError;
  }
  return { snapshotId };
});

const spies = {
  getChatsBySessionId: mock(
    async (_sessionId: string) => chatsInSession as never,
  ),
  getSessionById: mock(async (_sessionId: string) => sessionRecord as never),
  updateSession: mock(
    async (_sessionId: string, patch: Record<string, unknown>) => patch,
  ),
  connectSandbox: mock(async () => ({
    snapshot: snapshotSpy,
  })),
  snapshot: snapshotSpy,
};

mock.module("@/lib/db/sessions", () => ({
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
  sessionRecord = makeDueSession();
  chatsInSession = [];
  snapshotId = "snapshot-1";
  snapshotError = null;

  Object.values(spies).forEach((spy) => spy.mockClear());
});

describe("evaluateSandboxLifecycle", () => {
  test("skips hibernation whenever any chat still has an activeStreamId", async () => {
    chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-running-1" }];

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.connectSandbox).not.toHaveBeenCalled();
    expect(spies.updateSession).not.toHaveBeenCalled();
    expect(spies.snapshot).not.toHaveBeenCalled();
  });

  test("rechecks for activeStreamId before snapshotting and restores active lifecycle state", async () => {
    spies.connectSandbox.mockImplementationOnce(async () => {
      chatsInSession = [{ id: "chat-1", activeStreamId: "wrun-raced-in-1" }];
      return {
        snapshot: snapshotSpy,
      };
    });

    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "skipped", reason: "active-workflow" });
    expect(spies.getChatsBySessionId).toHaveBeenCalledTimes(2);
    expect(spies.snapshot).not.toHaveBeenCalled();

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch).toEqual({
      lifecycleState: "hibernating",
      lifecycleError: null,
    });
    expect(finalPatch).toEqual({
      lifecycleState: "active",
      lifecycleError: null,
      sandboxExpiresAt: null,
    });
    expect(finalPatch).not.toHaveProperty("lastActivityAt");
    expect(finalPatch).not.toHaveProperty("hibernateAfter");
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

  test("hibernates when no chat has an activeStreamId", async () => {
    const result = await evaluateSandboxLifecycle(
      "session-1",
      "status-check-overdue",
    );

    expect(result).toEqual({ action: "hibernated" });
    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.snapshot).toHaveBeenCalledTimes(1);

    const updateCalls = spies.updateSession.mock.calls as unknown[][];
    const firstPatch = updateCalls[0]?.[1] as Record<string, unknown>;
    const finalPatch = updateCalls.at(-1)?.[1] as Record<string, unknown>;

    expect(firstPatch.lifecycleState).toBe("hibernating");
    expect(finalPatch.lifecycleState).toBe("hibernated");
    expect(finalPatch.snapshotUrl).toBe("snapshot-1");
  });
});
