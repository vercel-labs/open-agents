import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface KickCall {
  sessionId: string;
  reason: string;
}

const kickCalls: KickCall[] = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];

let sessionRecord: {
  id: string;
  userId: string;
  sandboxState: {
    type: "vercel";
    sandboxId: string;
    expiresAt: number;
  };
  lifecycleState: "active" | "failed";
  lifecycleError: string | null;
  lifecycleVersion: number;
  hibernateAfter: Date | null;
  sandboxExpiresAt: Date | null;
  snapshotUrl: string | null;
  lastActivityAt: Date | null;
  updatedAt: Date;
};

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    sessionRecord = {
      ...sessionRecord,
      ...patch,
    } as typeof sessionRecord;
    return sessionRecord;
  },
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: KickCall) => {
    kickCalls.push(input);
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox/status lifecycle safety net", () => {
  beforeEach(() => {
    kickCalls.length = 0;
    updateCalls.length = 0;

    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      sandboxState: {
        type: "vercel",
        sandboxId: "sbx-1",
        expiresAt: Date.now() + 5 * 60_000,
      },
      lifecycleState: "active",
      lifecycleError: null,
      lifecycleVersion: 10,
      hibernateAfter: new Date(Date.now() - 2_000),
      sandboxExpiresAt: new Date(Date.now() + 5 * 60_000),
      snapshotUrl: null,
      lastActivityAt: new Date(Date.now() - 5_000),
      updatedAt: new Date(Date.now() - 5_000),
    };
  });

  test("kicks overdue lifecycle immediately", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sandbox/status?sessionId=session-1"),
    );

    expect(response.ok).toBe(true);
    expect(kickCalls.length).toBe(1);
    expect(kickCalls[0]).toEqual({
      sessionId: "session-1",
      reason: "status-check-overdue",
    });
    expect(updateCalls).toHaveLength(0);
  });

  test("recovers failed lifecycle state when runtime sandbox is still active", async () => {
    const { GET } = await routeModulePromise;

    sessionRecord.lifecycleState = "failed";
    sessionRecord.lifecycleError = "snapshot failed";
    sessionRecord.hibernateAfter = new Date(Date.now() + 30_000);

    const response = await GET(
      new Request("http://localhost/api/sandbox/status?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("active");
    expect(payload.lifecycle.state).toBe("active");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("active");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
    expect(kickCalls).toHaveLength(0);
  });
});
