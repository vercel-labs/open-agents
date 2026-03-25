import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";

mock.module("server-only", () => ({}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "vercel" };
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamId: string | null;
}

interface TestVercelAuthInfo {
  token: string;
  expiresAt: number;
  externalId: string;
}

interface KickCall {
  sessionId: string;
  reason: string;
}

interface ConnectConfig {
  state: {
    type: "vercel";
    sandboxId?: string;
  };
  options?: {
    gitUser?: {
      email?: string;
    };
  };
}

const kickCalls: KickCall[] = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectConfigs: ConnectConfig[] = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];
const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
  [];
const dotenvSyncCalls: Array<Record<string, unknown>> = [];

let sessionRecord: TestSessionRecord;
let currentVercelAuthInfo: TestVercelAuthInfo | null;
let currentDotenvContent: string;
let currentDotenvError: Error | null;

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

mock.module("@/lib/vercel/token", () => ({
  getUserVercelAuthInfo: async () => currentVercelAuthInfo,
  getUserVercelToken: async () => currentVercelAuthInfo?.token ?? null,
}));

mock.module("@/lib/vercel/projects", () => ({
  buildDevelopmentDotenvFromVercelProject: async (
    input: Record<string, unknown>,
  ) => {
    dotenvSyncCalls.push(input);
    if (currentDotenvError) {
      throw currentDotenvError;
    }
    return currentDotenvContent;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
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
  connectSandbox: async (config: ConnectConfig) => {
    connectConfigs.push(config);

    return {
      currentBranch: "main",
      workingDirectory: "/vercel/sandbox",
      getState: () => ({
        type: "vercel" as const,
        sandboxId: config.state.sandboxId ?? "sbx-vercel-1",
        expiresAt: Date.now() + 120_000,
      }),
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        execCalls.push({ command, cwd, timeoutMs });
        if (command === 'printf %s "$HOME"') {
          return {
            success: true,
            exitCode: 0,
            stdout: "/root",
            stderr: "",
            truncated: false,
          };
        }

        return {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          truncated: false,
        };
      },
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path, content });
      },
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
    writeFileCalls.length = 0;
    execCalls.length = 0;
    dotenvSyncCalls.length = 0;
    currentVercelAuthInfo = {
      token: "vercel-token",
      expiresAt: 1_700_000_000,
      externalId: "user_ext_1",
    };
    currentDotenvContent = 'API_KEY="secret"\n';
    currentDotenvError = null;
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      vercelProjectId: "project-1",
      vercelProjectName: "open-harness-web",
      vercelTeamId: "team-1",
    };
  });

  test("reconnect branch uses vercel sandbox and does not resync .env.local", async () => {
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
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(connectConfigs[0]?.state).toEqual({
      type: "vercel",
      sandboxId: "sbx-existing-1",
    });
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([
      {
        path: "/root/.local/share/com.vercel.cli/auth.json",
        content:
          '{\n  "token": "vercel-token",\n  "expiresAt": 1700000000\n}\n',
      },
      {
        path: "/vercel/sandbox/.vercel/project.json",
        content:
          '{\n  "orgId": "team-1",\n  "projectId": "project-1",\n  "projectName": "open-harness-web"\n}\n',
      },
    ]);
  });

  test("new vercel sandbox writes linked Development env vars to .env.local", async () => {
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
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(connectConfigs[0]?.options?.gitUser?.email).toBe(
      "12345+nico-gh@users.noreply.github.com",
    );
    expect(dotenvSyncCalls).toEqual([
      {
        token: "vercel-token",
        projectIdOrName: "project-1",
        teamId: "team-1",
      },
    ]);
    expect(writeFileCalls).toEqual([
      {
        path: "/vercel/sandbox/.env.local",
        content: 'API_KEY="secret"\n',
      },
      {
        path: "/root/.local/share/com.vercel.cli/auth.json",
        content:
          '{\n  "token": "vercel-token",\n  "expiresAt": 1700000000\n}\n',
      },
      {
        path: "/vercel/sandbox/.vercel/project.json",
        content:
          '{\n  "orgId": "team-1",\n  "projectId": "project-1",\n  "projectName": "open-harness-web"\n}\n',
      },
    ]);

    const payload = (await response.json()) as {
      timeout: number;
      mode: string;
    };
    expect(payload.timeout).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    expect(payload.mode).toBe("vercel");
  });

  test("env sync failures do not block sandbox creation", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvError = new Error("boom");

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(dotenvSyncCalls).toHaveLength(1);
    expect(writeFileCalls).toEqual([
      {
        path: "/root/.local/share/com.vercel.cli/auth.json",
        content:
          '{\n  "token": "vercel-token",\n  "expiresAt": 1700000000\n}\n',
      },
      {
        path: "/vercel/sandbox/.vercel/project.json",
        content:
          '{\n  "orgId": "team-1",\n  "projectId": "project-1",\n  "projectName": "open-harness-web"\n}\n',
      },
    ]);
  });

  test("rejects unsupported sandbox types", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "invalid",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid sandbox type");
    expect(connectConfigs).toHaveLength(0);
    expect(kickCalls).toHaveLength(0);
  });
});
