import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
    username: string;
    name?: string | null;
    email?: string | null;
  };
} | null;

type SessionRecord = {
  id: string;
  userId: string;
  cloneUrl: string | null;
  sandboxState: { type: "vercel" } | null;
};

type InstallationRecord = {
  accountType: "User" | "Organization";
  installationId: number;
} | null;

type WorkflowResult =
  | {
      ok: true;
      repoUrl?: string;
      cloneUrl: string;
      owner: string;
      repoName: string;
      branch: "main";
    }
  | {
      ok: false;
      response: Response;
    };

const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const workflowCalls: Array<Record<string, unknown>> = [];
const connectStates: unknown[] = [];

let authSession: AuthSession;
let sessionRecord: SessionRecord | null;
let installationRecord: InstallationRecord;
let installationTokenValue: string | null;
let installationTokenThrows: boolean;
let userToken: string | null;
let sandboxActive: boolean;
let workflowResult: WorkflowResult;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    if (sessionRecord) {
      return {
        ...sessionRecord,
        ...patch,
      };
    }

    return {
      ...patch,
    };
  },
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationByAccountLogin: async () => installationRecord,
}));

mock.module("@/lib/github/app-auth", () => ({
  getInstallationToken: async () => {
    if (installationTokenThrows || !installationTokenValue) {
      throw new Error("Failed to get installation token");
    }
    return installationTokenValue;
  },
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => userToken,
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => sandboxActive,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (state: unknown) => {
    connectStates.push(state);
    return {
      workingDirectory: "/sandbox",
    };
  },
}));

mock.module("@/app/api/github/create-repo/_lib/create-repo-workflow", () => ({
  runCreateRepoWorkflow: async (params: Record<string, unknown>) => {
    workflowCalls.push(params);
    return workflowResult;
  },
}));

const routeModulePromise = import("./route");

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/github/create-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/github/create-repo", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    workflowCalls.length = 0;
    connectStates.length = 0;

    authSession = {
      user: {
        id: "user-1",
        username: "alice",
        name: "Alice",
        email: "alice@example.com",
      },
    };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      cloneUrl: null,
      sandboxState: { type: "vercel" },
    };
    installationRecord = null;
    installationTokenValue = null;
    installationTokenThrows = false;
    userToken = "user-token";
    sandboxActive = true;
    workflowResult = {
      ok: true,
      repoUrl: "https://github.com/acme/repo-1",
      cloneUrl: "https://github.com/acme/repo-1.git",
      owner: "acme",
      repoName: "repo-1",
      branch: "main",
    };
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
        sessionTitle: "Session",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  test("returns 400 when owner installation is missing", async () => {
    installationRecord = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
        sessionTitle: "Session",
        owner: "acme-org",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'No GitHub App installation found for "acme-org". Install the GitHub App on that account first.',
    });
    expect(workflowCalls).toHaveLength(0);
  });

  test("returns 401 when no GitHub token is available", async () => {
    userToken = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
        sessionTitle: "Session",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "GitHub not connected" });
    expect(workflowCalls).toHaveLength(0);
  });

  test("forwards workflow failure responses", async () => {
    workflowResult = {
      ok: false,
      response: Response.json({ error: "Workflow failed" }, { status: 500 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
        sessionTitle: "Session",
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Workflow failed" });
    expect(updateCalls).toHaveLength(0);
  });

  test("uses organization installation token and updates session on success", async () => {
    installationRecord = {
      accountType: "Organization",
      installationId: 42,
    };
    installationTokenValue = "installation-token";
    userToken = null;

    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
        sessionTitle: "Session",
        owner: "acme-org",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      repoUrl: "https://github.com/acme/repo-1",
      cloneUrl: "https://github.com/acme/repo-1.git",
      owner: "acme",
      repoName: "repo-1",
      branch: "main",
    });

    expect(workflowCalls).toHaveLength(1);
    expect(workflowCalls[0]?.accountType).toBe("Organization");
    expect(workflowCalls[0]?.repoToken).toBe("installation-token");
    expect(workflowCalls[0]?.installationToken).toBe("installation-token");

    expect(updateCalls).toEqual([
      {
        sessionId: "session-1",
        patch: {
          repoOwner: "acme",
          repoName: "repo-1",
          cloneUrl: "https://github.com/acme/repo-1",
          branch: "main",
          isNewBranch: false,
        },
      },
    ]);
  });
});
