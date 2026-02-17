import { beforeEach, describe, expect, mock, test } from "bun:test";

interface KickCall {
  sessionId: string;
  reason: string;
}

const kickCalls: KickCall[] = [];

const sessionRecord = {
  id: "session-1",
  userId: "user-1",
  sandboxState: {
    type: "vercel",
    sandboxId: "sbx-1",
    expiresAt: Date.now() + 5 * 60_000,
  },
  lifecycleState: "active",
  lifecycleVersion: 10,
  hibernateAfter: new Date(Date.now() - 2_000),
  sandboxExpiresAt: new Date(Date.now() + 5 * 60_000),
  snapshotUrl: null,
  lastActivityAt: new Date(Date.now() - 5_000),
  updatedAt: new Date(Date.now() - 5_000),
};

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({ user: { id: "user-1" } }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
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
  });
});
