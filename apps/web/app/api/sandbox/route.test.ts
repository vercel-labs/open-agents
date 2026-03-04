import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "vercel" | "hybrid" | "just-bash" };
  repoOwner?: string;
  repoName?: string;
}

interface KickCall {
  sessionId: string;
  reason: string;
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

const kickCalls: KickCall[] = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectConfigs: unknown[] = [];

let sessionRecord: TestSessionRecord;
let vercelToken: string | null = null;
let vercelProjectResult: {
  ok: boolean;
  project?: { projectId: string; projectName: string; orgId: string; orgSlug?: string };
  reason?: string;
  message?: string;
} = { ok: false, reason: "no_vercel_auth" };

function isConnectConfig(value: unknown): value is {
  state: {
    type: "vercel" | "hybrid" | "just-bash";
    sandboxId?: string;
  };
} {
  if (!value || typeof value !== "object") return false;
  if (!("state" in value)) return false;
  const state = value.state;
  if (!state || typeof state !== "object") return false;
  if (!("type" in state)) return false;
  return (
    state.type === "vercel" ||
    state.type === "hybrid" ||
    state.type === "just-bash"
  );
}

mock.module("next/server", () => ({
  after: (callback: () => void | Promise<void>) => {
    void callback();
  },
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: {
      id: "user-1",
      username: "nico",
      name: "Nico",
      email: "nico@example.com",
    },
  }),
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => ({
    externalUserId: "12345",
    username: "nico-gh",
    accessToken: "token",
    refreshToken: null,
    expiresAt: null,
  }),
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => null,
}));

mock.module("@/lib/github/tarball", () => ({
  downloadAndExtractTarball: async () => ({ files: {} }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    return {
      ...sessionRecord,
      ...patch,
    };
  },
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => vercelToken,
}));

mock.module("@/lib/vercel/project-resolution", () => ({
  resolveVercelProject: async () => vercelProjectResult,
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: KickCall) => {
    kickCalls.push(input);
  },
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (config: unknown) => {
    connectConfigs.push(config);

    const nextState: {
      type: "vercel" | "hybrid";
      sandboxId: string;
      expiresAt: number;
    } = isConnectConfig(config)
      ? config.state.type === "vercel"
        ? {
            type: "vercel",
            sandboxId: "sbx-vercel-1",
            expiresAt: Date.now() + 120_000,
          }
        : {
            type: "hybrid",
            sandboxId: config.state.sandboxId ?? "sbx-hybrid-1",
            expiresAt: Date.now() + 120_000,
          }
      : {
          type: "vercel",
          sandboxId: "sbx-default-1",
          expiresAt: Date.now() + 120_000,
        };

    return {
      currentBranch: "main",
      workingDirectory: "/vercel/sandbox",
      getState: () => nextState,
      stop: async () => {},
    };
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox lifecycle kicks", () => {
  beforeEach(() => {
    kickCalls.length = 0;
    updateCalls.length = 0;
    connectConfigs.length = 0;
    vercelToken = null;
    vercelProjectResult = { ok: false, reason: "no_vercel_auth" };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
    };
  });

  test("reconnect branch kicks lifecycle immediately", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxId: "sbx-existing-1",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(true);
    expect(kickCalls.length).toBe(1);
    expect(kickCalls[0]?.sessionId).toBe("session-1");
    expect(kickCalls[0]?.reason).toBe("sandbox-created");
    expect(kickCalls[0]?.scheduleBackgroundWork).toBeUndefined();
  });

  test("new vercel sandbox kicks lifecycle immediately", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(true);
    expect(kickCalls.length).toBe(1);
    expect(kickCalls[0]?.sessionId).toBe("session-1");
    expect(kickCalls[0]?.reason).toBe("sandbox-created");
    expect(kickCalls[0]?.scheduleBackgroundWork).toBeUndefined();
    expect(updateCalls.length).toBeGreaterThan(0);

    const vercelConfig = connectConfigs.find(
      (config) => isConnectConfig(config) && config.state.type === "vercel",
    ) as { options?: { gitUser?: { email?: string } } } | undefined;

    expect(vercelConfig?.options?.gitUser?.email).toBe(
      "12345+nico-gh@users.noreply.github.com",
    );
  });

  test("injects Vercel env vars when project resolves", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      repoOwner: "acme",
      repoName: "app",
    };
    vercelToken = "tok_vercel_test";
    vercelProjectResult = {
      ok: true,
      project: {
        projectId: "prj_123",
        projectName: "my-app",
        orgId: "team_456",
        orgSlug: "acme",
      },
    };

    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(true);

    const config = connectConfigs.find(
      (c) => isConnectConfig(c) && c.state.type === "vercel",
    ) as { options?: { env?: Record<string, string> } } | undefined;

    expect(config?.options?.env?.VERCEL_TOKEN).toBe("tok_vercel_test");
    expect(config?.options?.env?.VERCEL_PROJECT_ID).toBe("prj_123");
    expect(config?.options?.env?.VERCEL_ORG_ID).toBe("team_456");
  });

  test("does not inject Vercel env when no token available", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      repoOwner: "acme",
      repoName: "app",
    };
    vercelToken = null;

    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(true);

    const config = connectConfigs.find(
      (c) => isConnectConfig(c) && c.state.type === "vercel",
    ) as { options?: { env?: Record<string, string> } } | undefined;

    expect(config?.options?.env?.VERCEL_TOKEN).toBeUndefined();
    expect(config?.options?.env?.VERCEL_PROJECT_ID).toBeUndefined();
  });

  test("does not inject Vercel env when no repo context", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      // no repoOwner/repoName
    };
    vercelToken = "tok_vercel_test";
    vercelProjectResult = {
      ok: true,
      project: {
        projectId: "prj_123",
        projectName: "my-app",
        orgId: "team_456",
      },
    };

    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(true);

    const config = connectConfigs.find(
      (c) => isConnectConfig(c) && c.state.type === "vercel",
    ) as { options?: { env?: Record<string, string> } } | undefined;

    // Should not have Vercel env since there's no repo context
    expect(config?.options?.env?.VERCEL_TOKEN).toBeUndefined();
    expect(config?.options?.env?.VERCEL_PROJECT_ID).toBeUndefined();
  });

  test("does not inject Vercel env on reconnect", async () => {
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "hybrid" },
      repoOwner: "acme",
      repoName: "app",
    };
    vercelToken = "tok_vercel_test";
    vercelProjectResult = {
      ok: true,
      project: {
        projectId: "prj_123",
        projectName: "my-app",
        orgId: "team_456",
      },
    };

    const { POST } = await routeModulePromise;

    // Reconnect uses sandboxId
    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxId: "sbx-existing-1",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(true);

    // On reconnect, the env should NOT contain Vercel vars
    // (reconnect path skips Vercel resolution because providedSandboxId is set,
    // but env dict is shared — the guard is !providedSandboxId in the condition)
    const config = connectConfigs[connectConfigs.length - 1] as {
      options?: { env?: Record<string, string> };
    } | undefined;

    expect(config?.options?.env?.VERCEL_TOKEN).toBeUndefined();
    expect(config?.options?.env?.VERCEL_PROJECT_ID).toBeUndefined();
  });
});
