import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];

let probeResult: {
  success: boolean;
  stdout: string;
  stderr: string;
};

let sessionRecord: {
  id: string;
  userId: string;
  snapshotUrl: string | null;
  lifecycleState: "failed" | "active" | "hibernated";
  lifecycleError: string | null;
  sandboxState: {
    type: "vercel";
    sandboxName?: string;
    expiresAt?: number;
  };
  lastActivityAt: Date | null;
  hibernateAfter: Date | null;
  sandboxExpiresAt: Date | null;
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
  requireOwnedSession: async () => ({ ok: true, sessionRecord }),
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    sessionRecord = {
      ...sessionRecord,
      ...patch,
    } as typeof sessionRecord;
    return sessionRecord;
  },
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildHibernatedLifecycleUpdate: () => ({
    lifecycleState: "hibernated",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  }),
  getSandboxExpiresAtDate: (
    state: { expiresAt?: unknown } | null | undefined,
  ) =>
    typeof state?.expiresAt === "number" ? new Date(state.expiresAt) : null,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (state: {
    type: "vercel";
    sandboxName?: string;
    expiresAt?: number;
  }) => {
    const expiresAt = Date.now() + 2 * 60_000;
    return {
      workingDirectory: "/vercel/sandbox",
      expiresAt,
      exec: async () => probeResult,
      getState: () => ({
        ...state,
        ...(state.sandboxName ? { sandboxName: state.sandboxName } : {}),
        expiresAt,
      }),
    };
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox/reconnect", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    probeResult = {
      success: true,
      stdout: "ok",
      stderr: "",
    };

    const now = Date.now();
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      snapshotUrl: "snap-1",
      lifecycleState: "failed",
      lifecycleError: "snapshot failed",
      sandboxState: {
        type: "vercel",
        sandboxName: "session_session-1",
        expiresAt: now + 5 * 60_000,
      },
      lastActivityAt: new Date(now - 5_000),
      hibernateAfter: new Date(now + 10_000),
      sandboxExpiresAt: new Date(now + 5 * 60_000),
    };
  });

  test("recovers failed lifecycle state when reconnect succeeds", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      hasSnapshot: boolean;
      expiresAt?: number;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("connected");
    expect(payload.hasSnapshot).toBe(false);
    expect(payload.lifecycle.state).toBe("active");
    expect(typeof payload.expiresAt).toBe("number");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("active");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
  });

  test("marks sandbox expired when the reconnect probe hits a 410", async () => {
    const { GET } = await routeModulePromise;

    probeResult = {
      success: false,
      stdout: "",
      stderr: "Status code 410 is not ok",
    };

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("expired");
    expect(payload.lifecycle.state).toBe("hibernated");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("hibernated");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
    expect(updateCalls[0]?.patch.sandboxState).toEqual({
      type: "vercel",
      sandboxName: "session_session-1",
    });
  });

  test("drops a missing sandbox resume handle when the reconnect probe hits a 404", async () => {
    const { GET } = await routeModulePromise;

    sessionRecord.snapshotUrl = null;
    probeResult = {
      success: false,
      stdout: "",
      stderr: "Status code 404 is not ok",
    };

    const response = await GET(
      new Request("http://localhost/api/sandbox/reconnect?sessionId=session-1"),
    );
    const payload = (await response.json()) as {
      status: string;
      hasSnapshot: boolean;
      lifecycle: { state: string | null };
    };

    expect(response.ok).toBe(true);
    expect(payload.status).toBe("expired");
    expect(payload.hasSnapshot).toBe(false);
    expect(payload.lifecycle.state).toBe("hibernated");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.sessionId).toBe("session-1");
    expect(updateCalls[0]?.patch.lifecycleState).toBe("hibernated");
    expect(updateCalls[0]?.patch.lifecycleError).toBeNull();
    expect(updateCalls[0]?.patch.sandboxState).toEqual({
      type: "vercel",
    });
  });
});
