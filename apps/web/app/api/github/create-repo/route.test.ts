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

type GitHubAccount = {
  username: string;
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
let githubAccount: GitHubAccount;
let userToken: string | null;
let sandboxActive: boolean;
let workflowResult: WorkflowResult;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  getGitHubUserProfile: async () => githubAccount,
  getUserGitHubToken: async () => userToken,
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

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => sandboxActive,
}));

mock.module("@open-agents/sandbox", () => ({
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
    githubAccount = {
      username: "alice-gh",
    };
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

  test("uses the OAuth token for personal repo creation", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
        sessionTitle: "Session",
        owner: "alice-gh",
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
    expect(workflowCalls[0]).toMatchObject({
      owner: "alice-gh",
      accountType: "User",
      repoToken: "user-token",
    });

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

  test("treats a different owner as an organization while still using the OAuth token", async () => {
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
    expect(workflowCalls).toHaveLength(1);
    expect(workflowCalls[0]).toMatchObject({
      owner: "acme-org",
      accountType: "Organization",
      repoToken: "user-token",
    });
  });
});
