import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "vercel" | "hybrid" | "just-bash" };
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

type MockConnectedSandbox = {
  currentBranch: string;
  workingDirectory: string;
  getState: () => {
    type: "vercel" | "hybrid";
    sandboxId: string;
    expiresAt: number;
  };
  stop: () => Promise<void>;
};

let connectSandboxImpl: (config: unknown) => Promise<MockConnectedSandbox>;

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

function buildMockConnectedSandbox(config: unknown): MockConnectedSandbox {
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

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: KickCall) => {
    kickCalls.push(input);
  },
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (config: unknown) => {
    connectConfigs.push(config);
    return connectSandboxImpl(config);
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox lifecycle kicks", () => {
  beforeEach(() => {
    kickCalls.length = 0;
    updateCalls.length = 0;
    connectConfigs.length = 0;
    connectSandboxImpl = async (config) => buildMockConnectedSandbox(config);
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

  test("vercel clone SSO errors return actionable 403 response", async () => {
    const { POST } = await routeModulePromise;

    connectSandboxImpl = async () => {
      throw new Error(
        [
          "Failed to clone repository 'https://github.com/vercel-labs/open-harness': Cloning into '.'...",
          "remote: The 'vercel-labs' organization has enabled or enforced SAML SSO.",
          "remote: To access this repository, you must re-authorize the GitHub App 'OpenHarness'.",
          "fatal: unable to access 'https://github.com/vercel-labs/open-harness.git/': The requested URL returned error: 403",
        ].join("\n"),
      );
    };

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);

    const body = (await response.json()) as {
      error?: string;
      reason?: string;
      actionUrl?: string;
    };
    expect(body.reason).toBe("github_sso_reauthorization_required");
    expect(body.actionUrl).toBe("/settings/accounts");
    expect(body.error).toContain("SSO re-authorization");

    expect(kickCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  test("unexpected sandbox errors return generic 500 response", async () => {
    const { POST } = await routeModulePromise;

    connectSandboxImpl = async () => {
      throw new Error("sandbox provisioning exploded");
    };

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);

    const body = (await response.json()) as {
      error?: string;
      reason?: string;
      actionUrl?: string;
    };
    expect(body.error).toBe("Failed to create sandbox. Please try again.");
    expect(body.reason).toBeUndefined();
    expect(body.actionUrl).toBeUndefined();

    expect(kickCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
  });
});
