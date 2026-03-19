import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  status: "running" | "archived";
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  cloneUrl: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
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

interface MockSandboxExecResult {
  success: boolean;
  stdout: string;
}

interface MockSandbox {
  workingDirectory: string;
  exec: (
    command: string,
    cwd: string,
    timeoutMs: number,
  ) => Promise<MockSandboxExecResult>;
  stop: () => Promise<void>;
  snapshot?: () => Promise<{ snapshotId: string }>;
}

type MockPullRequestStatusResult =
  | {
      success: true;
      status: "open" | "merged" | "closed";
    }
  | {
      success: false;
      error: string;
    };

type MockFindPullRequestByBranchResult =
  | {
      found: true;
      prNumber: number;
      prStatus: "open" | "merged" | "closed";
    }
  | {
      found: false;
      error?: string;
    };

let sessionRecord: TestSessionRecord | null = null;
let sandboxQueue: MockSandbox[] = [];

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
    const sandbox = sandboxQueue.shift();
    if (!sandbox) {
      throw new Error("sandbox connection failed");
    }

    return sandbox;
  }),
  getRepoToken: mock(async () => ({
    token: "repo-token",
    type: "installation" as const,
    installationId: 1,
  })),
  getPullRequestStatus: mock(
    async (): Promise<MockPullRequestStatusResult> => ({
      success: false,
      error: "Failed to get PR status",
    }),
  ),
  findPullRequestByBranch: mock(
    async (): Promise<MockFindPullRequestByBranchResult> => ({
      found: false,
    }),
  ),
};

mock.module("@/lib/db/sessions", () => ({
  getSessionById: spies.getSessionById,
  updateSession: spies.updateSession,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@/lib/github/get-repo-token", () => ({
  getRepoToken: spies.getRepoToken,
}));

mock.module("@/lib/github/client", () => ({
  getPullRequestStatus: spies.getPullRequestStatus,
  findPullRequestByBranch: spies.findPullRequestByBranch,
}));

const archiveSessionModulePromise = import("./archive-session");

function makeSessionRecord(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    status: "running",
    repoOwner: "acme",
    repoName: "widgets",
    branch: "feature/session-1",
    cloneUrl: "https://github.com/acme/widgets.git",
    prNumber: 42,
    prStatus: "open",
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

function createMockSandbox(overrides: Partial<MockSandbox> = {}): MockSandbox {
  return {
    workingDirectory: "/workspace",
    exec: async () => ({ success: true, stdout: "feature/session-1\n" }),
    stop: async () => {},
    ...overrides,
  };
}

beforeEach(() => {
  sessionRecord = makeSessionRecord();
  sandboxQueue = [];
  Object.values(spies).forEach((spy) => spy.mockClear());

  spies.getRepoToken.mockImplementation(async () => ({
    token: "repo-token",
    type: "installation",
    installationId: 1,
  }));
  spies.getPullRequestStatus.mockImplementation(async () => ({
    success: false,
    error: "Failed to get PR status",
  }));
  spies.findPullRequestByBranch.mockImplementation(async () => ({
    found: false,
  }));
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

  test("refreshes merged PR status before archiving", async () => {
    const { archiveSession } = await archiveSessionModulePromise;

    sandboxQueue = [createMockSandbox(), createMockSandbox()];
    spies.getPullRequestStatus.mockImplementation(async () => ({
      success: true,
      status: "merged",
    }));

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

    expect(updateCalls[0]?.[1]).toMatchObject({
      status: "archived",
      prStatus: "merged",
    });
    expect(spies.findPullRequestByBranch).not.toHaveBeenCalled();
    expect(sessionRecord?.prStatus).toBe("merged");
  });
});
