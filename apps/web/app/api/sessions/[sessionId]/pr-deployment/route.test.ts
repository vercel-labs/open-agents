import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const currentSessionRecord = {
  userId: "user-1",
  repoOwner: "vercel",
  repoName: "open-agents",
  branch: "feature/preview",
  vercelProjectId: "project-1",
  vercelTeamId: "team-1",
  prNumber: null as number | null,
};

let currentVercelToken: string | null = "vercel-token";
let currentBranchDeploymentUrl: string | null = null;
let currentBuildingDeploymentUrl: string | null = null;
let currentFailedDeploymentInspectorUrl: string | null = null;
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
const findLatestBuildingDeploymentUrlForBranchMock = mock(
  async () => currentBuildingDeploymentUrl,
);
const findLatestFailedDeploymentInspectorUrlForBranchMock = mock(
  async () => currentFailedDeploymentInspectorUrl,
);
const getUserGitHubTokenMock = mock(async () => "repo-token");
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
  findLatestBuildingDeploymentUrlForBranch:
    findLatestBuildingDeploymentUrlForBranchMock,
  findLatestFailedDeploymentInspectorUrlForBranch:
    findLatestFailedDeploymentInspectorUrlForBranchMock,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: getUserGitHubTokenMock,
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
    currentSessionRecord.repoName = "open-agents";
    currentSessionRecord.branch = "feature/preview";
    currentSessionRecord.vercelProjectId = "project-1";
    currentSessionRecord.vercelTeamId = "team-1";
    currentSessionRecord.prNumber = null;
    currentVercelToken = "vercel-token";
    currentBranchDeploymentUrl = null;
    currentBuildingDeploymentUrl = null;
    currentFailedDeploymentInspectorUrl = null;
    currentPullRequestDeploymentResult = { success: false };
    getUserVercelTokenMock.mockClear();
    findLatestPreviewDeploymentUrlForBranchMock.mockClear();
    findLatestBuildingDeploymentUrlForBranchMock.mockClear();
    findLatestFailedDeploymentInspectorUrlForBranchMock.mockClear();
    getUserGitHubTokenMock.mockClear();
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
    expect(getUserGitHubTokenMock).toHaveBeenCalledTimes(0);
    expect(
      findLatestVercelDeploymentUrlForPullRequestMock,
    ).toHaveBeenCalledTimes(0);
  });

  test("returns buildingDeploymentUrl when a deployment is still building", async () => {
    const { GET } = await routeModulePromise;

    currentBranchDeploymentUrl = "https://project-preview.vercel.app";
    currentBuildingDeploymentUrl = "https://project-building.vercel.app";

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/pr-deployment"),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      deploymentUrl: string | null;
      buildingDeploymentUrl: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://project-preview.vercel.app");
    expect(body.buildingDeploymentUrl).toBe(
      "https://project-building.vercel.app",
    );
  });

  test("returns buildingDeploymentUrl even when no ready deployment exists yet", async () => {
    const { GET } = await routeModulePromise;

    currentBranchDeploymentUrl = null;
    currentBuildingDeploymentUrl = "https://project-building.vercel.app";

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/pr-deployment"),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      deploymentUrl: string | null;
      buildingDeploymentUrl: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBeNull();
    expect(body.buildingDeploymentUrl).toBe(
      "https://project-building.vercel.app",
    );
  });

  test("uses the requested branch for preview lookup so freshly-created branches resolve immediately", async () => {
    const { GET } = await routeModulePromise;

    currentSessionRecord.branch = "main";
    currentBranchDeploymentUrl = "https://project-preview.vercel.app";

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/pr-deployment?branch=feature/fresh-preview",
      ),
      createRouteContext(),
    );
    const body = (await response.json()) as { deploymentUrl: string | null };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://project-preview.vercel.app");
    expect(findLatestPreviewDeploymentUrlForBranchMock).toHaveBeenCalledWith({
      token: "vercel-token",
      projectIdOrName: "project-1",
      branch: "feature/fresh-preview",
      teamId: "team-1",
    });
  });

  test("prefers Vercel API over PR comment lookup when both return a URL", async () => {
    const { GET } = await routeModulePromise;

    currentSessionRecord.prNumber = 42;
    currentBranchDeploymentUrl = "https://branch-preview.vercel.app";
    currentPullRequestDeploymentResult = {
      success: true,
      deploymentUrl: "https://pr-preview.vercel.app",
    };

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/pr-deployment?prNumber=42&branch=feature/preview",
      ),
      createRouteContext(),
    );
    const body = (await response.json()) as { deploymentUrl: string | null };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://branch-preview.vercel.app");
    expect(findLatestPreviewDeploymentUrlForBranchMock).toHaveBeenCalledTimes(
      1,
    );
    // Vercel API returned a result so GitHub fallback is not needed
    expect(getUserGitHubTokenMock).toHaveBeenCalledTimes(0);
    expect(
      findLatestVercelDeploymentUrlForPullRequestMock,
    ).toHaveBeenCalledTimes(0);
  });

  test("falls back to PR comment lookup when Vercel API has no deployment", async () => {
    const { GET } = await routeModulePromise;

    currentSessionRecord.prNumber = 42;
    currentBranchDeploymentUrl = null;
    currentBuildingDeploymentUrl = null;
    currentFailedDeploymentInspectorUrl = null;
    currentPullRequestDeploymentResult = {
      success: true,
      deploymentUrl: "https://pr-preview.vercel.app",
    };

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/pr-deployment?prNumber=42&branch=feature/preview",
      ),
      createRouteContext(),
    );
    const body = (await response.json()) as { deploymentUrl: string | null };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://pr-preview.vercel.app");
    expect(getUserGitHubTokenMock).toHaveBeenCalledTimes(1);
    expect(
      findLatestVercelDeploymentUrlForPullRequestMock,
    ).toHaveBeenCalledWith({
      owner: "vercel",
      repo: "open-agents",
      prNumber: 42,
      token: "repo-token",
    });
  });

  test("returns failedDeploymentUrl when only a failed deployment exists", async () => {
    const { GET } = await routeModulePromise;

    currentBranchDeploymentUrl = null;
    currentBuildingDeploymentUrl = null;
    currentFailedDeploymentInspectorUrl =
      "https://vercel.com/team/project/dpl_failed123";

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/pr-deployment"),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      deploymentUrl: string | null;
      buildingDeploymentUrl: string | null;
      failedDeploymentUrl: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBeNull();
    expect(body.buildingDeploymentUrl).toBeNull();
    expect(body.failedDeploymentUrl).toBe(
      "https://vercel.com/team/project/dpl_failed123",
    );
  });

  test("returns failedDeploymentUrl alongside a ready deployment", async () => {
    const { GET } = await routeModulePromise;

    currentBranchDeploymentUrl = "https://project-preview.vercel.app";
    currentBuildingDeploymentUrl = null;
    currentFailedDeploymentInspectorUrl =
      "https://vercel.com/team/project/dpl_failed456";

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/pr-deployment"),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      deploymentUrl: string | null;
      failedDeploymentUrl: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.deploymentUrl).toBe("https://project-preview.vercel.app");
    expect(body.failedDeploymentUrl).toBe(
      "https://vercel.com/team/project/dpl_failed456",
    );
  });

  test("returns failedDeploymentUrl for PR sessions via Vercel API", async () => {
    const { GET } = await routeModulePromise;

    currentSessionRecord.prNumber = 42;
    currentFailedDeploymentInspectorUrl =
      "https://vercel.com/team/project/dpl_failed789";
    currentPullRequestDeploymentResult = {
      success: true,
      deploymentUrl: "https://pr-preview.vercel.app",
    };

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/pr-deployment?prNumber=42&branch=feature/preview",
      ),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      deploymentUrl: string | null;
      failedDeploymentUrl?: string | null;
    };

    expect(response.status).toBe(200);
    // Vercel API finds the failed deployment even with a PR
    expect(body.failedDeploymentUrl).toBe(
      "https://vercel.com/team/project/dpl_failed789",
    );
    expect(
      findLatestFailedDeploymentInspectorUrlForBranchMock,
    ).toHaveBeenCalledTimes(1);
  });
});
