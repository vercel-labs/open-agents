import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { VercelProjectSelection } from "@/lib/vercel/types";

let currentSession: {
  user: {
    id: string;
    username: string;
    name: string;
  };
} | null = {
  user: {
    id: "user-1",
    username: "nico",
    name: "Nico",
  },
};
let savedLink: VercelProjectSelection | null = null;
const createCalls: Array<Record<string, unknown>> = [];
const upsertCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/random-city", () => ({
  getRandomCityName: () => "Oslo",
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-haiku-4.5",
    autoCommitPush: false,
  }),
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => savedLink,
  upsertVercelProjectLink: async (input: Record<string, unknown>) => {
    upsertCalls.push(input);
  },
}));

mock.module("@/lib/db/sessions", () => ({
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

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions POST vercel project linking", () => {
  beforeEach(() => {
    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
      },
    };
    savedLink = null;
    createCalls.length = 0;
    upsertCalls.length = 0;
  });

  test("explicit Vercel project is persisted on the session and remembered for the repo", async () => {
    const { POST } = await routeModulePromise;

    const vercelProject: VercelProjectSelection = {
      projectId: "project-1",
      projectName: "app",
      teamId: "team-1",
      teamSlug: "acme",
    };

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
        project: vercelProject,
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
        repoName: "open-harness",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-harness",
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
        repoName: "open-harness",
        branch: "main",
        cloneUrl: "https://github.com/vercel/open-harness",
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
});
