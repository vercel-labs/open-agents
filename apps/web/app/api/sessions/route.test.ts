import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { VercelProjectSelection } from "@/lib/vercel/types";

let currentSession: {
  authProvider?: "vercel" | "github";
  user: {
    id: string;
    username: string;
    name: string;
    email?: string;
  };
} | null = {
  user: {
    id: "user-1",
    username: "nico",
    name: "Nico",
  },
};
let existingSessionCount = 0;
let savedLink: VercelProjectSelection | null = null;
let currentVercelToken: string | null = "vercel-token";
let matchingProjects: VercelProjectSelection[] = [];
let matchingProjectsError: Error | null = null;
const createCalls: Array<Record<string, unknown>> = [];
const upsertCalls: Array<Record<string, unknown>> = [];

const originalNodeEnv = process.env.NODE_ENV;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/random-city", () => ({
  getRandomCityName: () => "Oslo",
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: true,
    alertSoundEnabled: true,
    publicUsageEnabled: false,
    globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    modelVariants: [],
    enabledModelIds: [],
  }),
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => savedLink,
  upsertVercelProjectLink: async (input: Record<string, unknown>) => {
    upsertCalls.push(input);
  },
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => currentVercelToken,
}));

mock.module("@/lib/vercel/projects", () => ({
  isVercelInvalidTokenError: (error: unknown) =>
    matchingProjectsError !== null && error === matchingProjectsError,
  listMatchingVercelProjects: async () => {
    if (matchingProjectsError) {
      throw matchingProjectsError;
    }
    return matchingProjects;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  countSessionsByUserId: async () => existingSessionCount,
  createSessionWithInitialChat: async (input: {
    session: Record<string, unknown>;
    initialChat: Record<string, unknown>;
  }) => {
    createCalls.push(input.session);
    return {
      session: {
        ...input.session,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      chat: {
        id: String(input.initialChat.id),
        sessionId: String(input.session.id),
        title: String(input.initialChat.title),
        modelId: String(input.initialChat.modelId),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  },
  getArchivedSessionCountByUserId: async () => 0,
  getSessionsWithUnreadByUserId: async () => [],
  getUsedSessionTitles: async () => new Set<string>(),
}));

const routeModulePromise = import("./route");

function createJsonRequest(
  body: unknown,
  url = "http://localhost/api/sessions",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions POST vercel project linking", () => {
  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  });

  beforeEach(() => {
    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
      },
    };
    existingSessionCount = 0;
    savedLink = null;
    currentVercelToken = "vercel-token";
    matchingProjects = [];
    matchingProjectsError = null;
    createCalls.length = 0;
    upsertCalls.length = 0;
  });

  test("blocks additional sessions for managed template trial users", async () => {
    const { POST } = await routeModulePromise;

    currentSession = {
      authProvider: "vercel",
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
        email: "person@example.com",
      },
    };
    existingSessionCount = 1;

    const response = await POST(
      createJsonRequest(
        {
          branch: "main",
          cloneUrl: "https://github.com/vercel-labs/open-agents",
          repoOwner: "vercel-labs",
          repoName: "open-agents",
        },
        "https://open-agents.dev/api/sessions",
      ),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "This hosted demo includes 1 trial session. Deploy your own copy to unlock the full Open Agents template.",
    );
    expect(createCalls).toHaveLength(0);
  });

  test("blocks repo-backed sessions for trial users", async () => {
    Object.assign(process.env, { NODE_ENV: "development" });
    const { POST } = await routeModulePromise;

    currentSession = {
      authProvider: "vercel",
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
        email: "person@example.com",
      },
    };

    const response = await POST(
      createJsonRequest({
        branch: "main",
        cloneUrl: "https://github.com/vercel-labs/open-agents",
        repoOwner: "vercel-labs",
        repoName: "open-agents",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "GitHub-backed sessions are disabled in the hosted demo. Deploy your own copy to unlock repository support, or start a new chat without a repository.",
    );
    expect(createCalls).toHaveLength(0);
  });

  test("explicit Vercel project is validated against live repo matches before it is persisted", async () => {
    const { POST } = await routeModulePromise;

    const vercelProject: VercelProjectSelection = {
      projectId: "project-1",
      projectName: "tampered-name",
      teamId: "team-x",
      teamSlug: "tampered-team",
    };
    matchingProjects = [
      {
        projectId: "project-1",
        projectName: "app",
        teamId: "team-1",
        teamSlug: "acme",
      },
    ];

    const response = await POST(
      createJsonRequest({
        repoOwner: "Vercel",
        repoName: "Open-Harness",
        branch: "main",
        cloneUrl: "https://github.com/Vercel/Open-Harness",
        vercelProject,
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toEqual([
      {
        userId: "user-1",
        repoOwner: "Vercel",
        repoName: "Open-Harness",
        project: matchingProjects[0],
      },
    ]);
    expect(createCalls[0]).toMatchObject({
      repoOwner: "Vercel",
      repoName: "Open-Harness",
      vercelProjectId: "project-1",
      vercelProjectName: "app",
      vercelTeamId: "team-1",
      vercelTeamSlug: "acme",
    });
    expect(body.session.vercelProjectId).toBe("project-1");
    expect(body.session.vercelProjectName).toBe("app");
  });

  test("rejects explicit Vercel projects that are not a live match for the repo", async () => {
    const { POST } = await routeModulePromise;

    matchingProjects = [
      {
        projectId: "project-2",
        projectName: "dashboard",
        teamId: null,
        teamSlug: null,
      },
    ];

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
        vercelProject: {
          projectId: "project-999",
          projectName: "rogue-project",
          teamId: null,
          teamSlug: null,
        },
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "Selected Vercel project no longer matches this repository",
    );
    expect(upsertCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(0);
  });

  test("omitting vercelProject falls back to the saved repo link", async () => {
    const { POST } = await routeModulePromise;

    savedLink = {
      projectId: "project-2",
      projectName: "dashboard",
      teamId: null,
      teamSlug: null,
    };

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(0);
    expect(createCalls[0]).toMatchObject({
      vercelProjectId: "project-2",
      vercelProjectName: "dashboard",
      vercelTeamId: null,
      vercelTeamSlug: null,
    });
    expect(body.session.vercelProjectName).toBe("dashboard");
  });

  test("explicit null suppresses Vercel linking for that session", async () => {
    const { POST } = await routeModulePromise;

    savedLink = {
      projectId: "project-2",
      projectName: "dashboard",
      teamId: null,
      teamSlug: null,
    };

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
        vercelProject: null,
      }),
    );
    const body = (await response.json()) as {
      session: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(0);
    expect(createCalls[0]).toMatchObject({
      vercelProjectId: null,
      vercelProjectName: null,
      vercelTeamId: null,
      vercelTeamSlug: null,
    });
    expect(body.session.vercelProjectId).toBeNull();
  });

  test("new sessions snapshot the user global skill refs", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    });
  });

  test("rejects invalid repository owners", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: 'vercel" && echo nope && "',
        repoName: "open-agents",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-agents",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid repository owner");
    expect(createCalls).toHaveLength(0);
  });

  test("persists autoCreatePr when autoCommitPush is enabled", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        repoOwner: "vercel",
        repoName: "open-agents",
        branch: "feature/auto-pr",
        cloneUrl: "https://github.com/vercel/open-agents",
        autoCommitPush: true,
        autoCreatePr: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      autoCommitPushOverride: true,
      autoCreatePrOverride: true,
    });
  });
});
