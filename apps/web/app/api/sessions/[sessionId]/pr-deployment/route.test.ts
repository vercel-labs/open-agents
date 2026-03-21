import { beforeEach, describe, expect, mock, test } from "bun:test";

const currentSessionRecord = {
  userId: "user-1",
  repoOwner: "vercel",
  repoName: "open-harness",
  branch: "feature/preview",
  vercelProjectId: "project-1",
  vercelTeamId: "team-1",
  prNumber: null as number | null,
};

let currentVercelToken: string | null = "vercel-token";
let currentBranchDeploymentUrl: string | null = null;
let currentPullRequestDeploymentResult: {
  success: boolean;
  deploymentUrl?: string | null;
} = {
  success: false,
};

const getUserVercelTokenMock = mock(async () => currentVercelToken);
const findLatestPreviewDeploymentUrlForBranchMock = mock(
  async () => currentBranchDeploymentUrl,
);
const getRepoTokenMock = mock(async () => ({ token: "repo-token" }));
const findLatestVercelDeploymentUrlForPullRequestMock = mock(
  async () => currentPullRequestDeploymentResult,
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true,
    userId: "user-1",
  }),
  requireOwnedSession: async () => ({
    ok: true,
    sessionRecord: currentSessionRecord,
  }),
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: getUserVercelTokenMock,
}));

mock.module("@/lib/vercel/projects", () => ({
  findLatestPreviewDeploymentUrlForBranch:
    findLatestPreviewDeploymentUrlForBranchMock,
}));

mock.module("@/lib/github/get-repo-token", () => ({
  getRepoToken: getRepoTokenMock,
}));

mock.module("@/lib/github/client", () => ({
  findLatestVercelDeploymentUrlForPullRequest:
    findLatestVercelDeploymentUrlForPullRequestMock,
}));

const routeModulePromise = import("./route");

function createRouteContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/pr-deployment", () => {
  beforeEach(() => {
    currentSessionRecord.repoOwner = "vercel";
    currentSessionRecord.repoName = "open-harness";
    currentSessionRecord.branch = "feature/preview";
    currentSessionRecord.vercelProjectId = "project-1";
    currentSessionRecord.vercelTeamId = "team-1";
    currentSessionRecord.prNumber = null;
    currentVercelToken = "vercel-token";
    currentBranchDeploymentUrl = null;
    currentPullRequestDeploymentResult = { success: false };
    getUserVercelTokenMock.mockClear();
    findLatestPreviewDeploymentUrlForBranchMock.mockClear();
    getRepoTokenMock.mockClear();
    findLatestVercelDeploymentUrlForPullRequestMock.mockClear();
  });

  test("returns the latest branch preview directly from Vercel without requiring a PR", async () => {
    const { GET } = await routeModulePromise;

    currentBranchDeploymentUrl = "https://project-preview.vercel.app";

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/pr-deployment"),
      createRouteContext(),
    );
    const body = (await response.json()) as { deploymentUrl: string | null };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://project-preview.vercel.app");
    expect(getUserVercelTokenMock).toHaveBeenCalledTimes(1);
    expect(findLatestPreviewDeploymentUrlForBranchMock).toHaveBeenCalledWith({
      token: "vercel-token",
      projectIdOrName: "project-1",
      branch: "feature/preview",
      teamId: "team-1",
    });
    expect(getRepoTokenMock).toHaveBeenCalledTimes(0);
    expect(
      findLatestVercelDeploymentUrlForPullRequestMock,
    ).toHaveBeenCalledTimes(0);
  });

  test("falls back to the PR-based lookup when no branch preview is available yet", async () => {
    const { GET } = await routeModulePromise;

    currentSessionRecord.prNumber = 42;
    currentPullRequestDeploymentResult = {
      success: true,
      deploymentUrl: "https://pr-preview.vercel.app",
    };

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/pr-deployment?prNumber=42",
      ),
      createRouteContext(),
    );
    const body = (await response.json()) as { deploymentUrl: string | null };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://pr-preview.vercel.app");
    expect(findLatestPreviewDeploymentUrlForBranchMock).toHaveBeenCalledTimes(
      1,
    );
    expect(getRepoTokenMock).toHaveBeenCalledTimes(1);
    expect(
      findLatestVercelDeploymentUrlForPullRequestMock,
    ).toHaveBeenCalledWith({
      owner: "vercel",
      repo: "open-harness",
      prNumber: 42,
      token: "repo-token",
    });
  });
});
