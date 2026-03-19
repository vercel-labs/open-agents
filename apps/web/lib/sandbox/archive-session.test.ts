import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  status: "running" | "archived";
  sandboxState: {
    type: "vercel";
    sandboxId?: string;
  } | null;
  snapshotUrl: string | null;
  lifecycleState: "active" | "archived" | null;
  lifecycleError: string | null;
  sandboxExpiresAt: Date | null;
  hibernateAfter: Date | null;
}

let sessionRecord: TestSessionRecord | null = null;

const spies = {
  getSessionById: mock(async (_sessionId: string) => {
    if (!sessionRecord) {
      return null;
    }

    return {
      ...sessionRecord,
      sandboxState: sessionRecord.sandboxState
        ? { ...sessionRecord.sandboxState }
        : null,
    };
  }),
  updateSession: mock(
    async (_sessionId: string, patch: Record<string, unknown>) => {
      if (!sessionRecord) {
        return null;
      }

      sessionRecord = {
        ...sessionRecord,
        ...(patch as Partial<TestSessionRecord>),
      };

      return {
        ...sessionRecord,
        sandboxState: sessionRecord.sandboxState
          ? { ...sessionRecord.sandboxState }
          : null,
      };
    },
  ),
  connectSandbox: mock(async () => {
    throw new Error("sandbox connection failed");
  }),
};

mock.module("@/lib/db/sessions", () => ({
  getSessionById: spies.getSessionById,
  updateSession: spies.updateSession,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

const archiveSessionModulePromise = import("./archive-session");

function makeSessionRecord(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: "session-1",
    status: "running",
    sandboxState: {
      type: "vercel",
      sandboxId: "sandbox-1",
    },
    snapshotUrl: null,
    lifecycleState: "active",
    lifecycleError: null,
    sandboxExpiresAt: new Date("2025-01-01T00:00:00.000Z"),
    hibernateAfter: new Date("2025-01-01T00:10:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  sessionRecord = makeSessionRecord();
  Object.values(spies).forEach((spy) => spy.mockClear());
});

describe("archiveSession", () => {
  test("clears runtime sandbox state when archive finalization fails without a snapshot", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    let backgroundTask: Promise<void> | null = null;

    const result = await archiveSession("session-1", {
      logPrefix: "[Test]",
      scheduleBackgroundWork: (callback) => {
        backgroundTask = callback();
      },
    });

    expect(result.archiveTriggered).toBe(true);
    if (!backgroundTask) {
      throw new Error("Expected archive finalization task to be scheduled");
    }
    await backgroundTask;

    const updateCalls = spies.updateSession.mock.calls as Array<
      [string, Record<string, unknown>]
    >;

    expect(updateCalls).toHaveLength(2);
    const recoveryPatch = updateCalls[1]?.[1];

    expect(recoveryPatch).toMatchObject({
      lifecycleState: "archived",
      sandboxExpiresAt: null,
      hibernateAfter: null,
      lifecycleError: "Archive finalization failed: sandbox connection failed",
      sandboxState: { type: "vercel" },
    });

    expect(sessionRecord?.sandboxState).toEqual({ type: "vercel" });
  });

  test("preserves runtime sandbox state when archive finalization fails but snapshot already exists", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    sessionRecord = makeSessionRecord({ snapshotUrl: "snapshot-existing" });

    let backgroundTask: Promise<void> | null = null;

    const result = await archiveSession("session-1", {
      logPrefix: "[Test]",
      scheduleBackgroundWork: (callback) => {
        backgroundTask = callback();
      },
    });

    expect(result.archiveTriggered).toBe(true);
    if (!backgroundTask) {
      throw new Error("Expected archive finalization task to be scheduled");
    }
    await backgroundTask;

    const updateCalls = spies.updateSession.mock.calls as Array<
      [string, Record<string, unknown>]
    >;

    expect(updateCalls).toHaveLength(2);
    const recoveryPatch = updateCalls[1]?.[1];

    expect(recoveryPatch?.lifecycleError).toBe(
      "Archive finalization failed: sandbox connection failed",
    );
    expect(recoveryPatch?.sandboxState).toBeUndefined();
    expect(sessionRecord?.sandboxState).toEqual({
      type: "vercel",
      sandboxId: "sandbox-1",
    });
  });
});
