import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { AutoCreatePrResult } from "./auto-pr-direct";

mock.module("server-only", () => ({}));

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr?: string;
};

let execResults: Map<string, ExecResult>;
let userTokenResult: string | null = "ghu_user";
let cachedBranchesResult: { branches: string[]; defaultBranch: string } | null =
  {
    branches: ["main", "feature-branch"],
    defaultBranch: "main",
  };
let findPullRequestResult: {
  found: boolean;
  prNumber?: number;
  prStatus?: "open" | "closed" | "merged";
  prUrl?: string;
  error?: string;
} = { found: false };
let openPullRequestResult: {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
} = {
  success: true,
  prNumber: 42,
  prUrl: "https://github.com/acme/repo/pull/42",
};
let prContentResult:
  | {
      success: true;
      title: string;
      body: string;
      diffStats: string;
      commitLog: string;
      baseRef: string;
      mergeBase: string | null;
    }
  | { success: false; error: string } = {
  success: true,
  title: "feat: improve auto pr",
  body: "## Summary\n\nAdds auto PR support.",
  diffStats: " file.ts | 1 +",
  commitLog: "abc123 feat: improve auto pr",
  baseRef: "origin/main",
  mergeBase: "abc123",
};

const execSpy = mock(async (command: string): Promise<ExecResult> => {
  for (const [prefix, result] of execResults) {
    if (command.startsWith(prefix) || command.includes(prefix)) {
      return result;
    }
  }

  return { success: true, stdout: "", stderr: "" };
});

const updateSessionSpy = mock(async () => {});
const fetchGitHubBranchesSpy = mock(async () => cachedBranchesResult);
const findPullRequestSpy = mock(async () => findPullRequestResult);
const openPullRequestSpy = mock(async () => openPullRequestResult);
const generatePullRequestContentFromSandboxSpy = mock(
  async () => prContentResult,
);
const getUserGitHubTokenSpy = mock(async (_userId?: string) => userTokenResult);
const getGitHubAppUserTokenSpy = mock(async (_userId?: string) =>
  getUserGitHubTokenSpy(_userId),
);
const withTemporaryGitHubAuthSpy = mock(
  async (
    _sandbox: unknown,
    _token: string | undefined,
    operation: () => Promise<unknown>,
  ) => operation(),
);
const mintInstallationTokenSpy = mock(async () => ({
  token: "ghs_read",
  expiresAt: null,
  installationId: 999,
  repositoryIds: [123],
  permissions: { contents: "read" },
}));
const revokeInstallationTokenSpy = mock(async () => {});
const verifyRepoAccessSpy = mock(async () => ({
  ok: true,
  installationId: 999,
  repositoryId: 123,
  defaultBranch: "main",
}));

const sandbox = {
  workingDirectory: "/vercel/sandbox",
  exec: execSpy,
};

mock.module("@open-agents/sandbox", () => ({
  withTemporaryGitHubAuth: withTemporaryGitHubAuthSpy,
}));

mock.module("@/lib/git/helpers", () => ({
  looksLikeCommitHash: (value: string) => /^[0-9a-f]{7,40}$/i.test(value),
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => null,
  updateSession: updateSessionSpy,
}));

mock.module("@/lib/github/repos", () => ({
  fetchGitHubBranches: fetchGitHubBranchesSpy,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: getUserGitHubTokenSpy,
  getGitHubAppUserToken: getGitHubAppUserTokenSpy,
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: verifyRepoAccessSpy,
  getRepoAccessErrorMessage: () => "Access denied",
}));

mock.module("@/lib/github/app", () => ({
  mintInstallationToken: mintInstallationTokenSpy,
  revokeInstallationToken: revokeInstallationTokenSpy,
}));

mock.module("@/lib/github/pulls", () => ({
  findPullRequest: findPullRequestSpy,
  openPullRequest: openPullRequestSpy,
}));

mock.module("@/lib/github/pr-content", () => ({
  generatePullRequestContentFromSandbox:
    generatePullRequestContentFromSandboxSpy,
}));

const { performAutoCreatePr } = await import("./auto-pr-direct");

function defaultExecResults(): Map<string, ExecResult> {
  return new Map<string, ExecResult>([
    [
      "git symbolic-ref --short HEAD",
      { success: true, stdout: "feature-branch" },
    ],
    ["git fetch origin", { success: true, stdout: "" }],
    ["git rev-parse HEAD", { success: true, stdout: "abc123" }],
    [
      "git ls-remote --heads origin",
      {
        success: true,
        stdout: "abc123\trefs/heads/feature-branch",
      },
    ],
    [
      "git symbolic-ref refs/remotes/origin/HEAD",
      { success: true, stdout: "refs/remotes/origin/main" },
    ],
  ]);
}

function makeParams() {
  return {
    sandbox: sandbox as never,
    userId: "user-1",
    sessionId: "session-1",
    sessionTitle: "Auto PR session",
    repoOwner: "acme",
    repoName: "repo",
  };
}

beforeEach(() => {
  execSpy.mockClear();
  updateSessionSpy.mockClear();
  fetchGitHubBranchesSpy.mockClear();
  findPullRequestSpy.mockClear();
  openPullRequestSpy.mockClear();
  generatePullRequestContentFromSandboxSpy.mockClear();
  getUserGitHubTokenSpy.mockClear();
  getGitHubAppUserTokenSpy.mockClear();
  withTemporaryGitHubAuthSpy.mockClear();
  mintInstallationTokenSpy.mockClear();
  revokeInstallationTokenSpy.mockClear();
  verifyRepoAccessSpy.mockClear();

  execResults = defaultExecResults();
  userTokenResult = "ghu_user";
  cachedBranchesResult = {
    branches: ["main", "feature-branch"],
    defaultBranch: "main",
  };
  findPullRequestResult = { found: false };
  openPullRequestResult = {
    success: true,
    prNumber: 42,
    prUrl: "https://github.com/acme/repo/pull/42",
  };
  prContentResult = {
    success: true,
    title: "feat: improve auto pr",
    body: "## Summary\n\nAdds auto PR support.",
    diffStats: " file.ts | 1 +",
    commitLog: "abc123 feat: improve auto pr",
    baseRef: "origin/main",
    mergeBase: "abc123",
  };
});

describe("performAutoCreatePr", () => {
  test("skips when the current branch is detached", async () => {
    execResults.set("git symbolic-ref --short HEAD", {
      success: false,
      stdout: "",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is detached",
    } satisfies AutoCreatePrResult);
    expect(openPullRequestSpy).not.toHaveBeenCalled();
  });

  test("skips when the current branch matches the default branch", async () => {
    execResults.set("git symbolic-ref --short HEAD", {
      success: true,
      stdout: "main",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch matches the default branch",
    } satisfies AutoCreatePrResult);
    expect(openPullRequestSpy).not.toHaveBeenCalled();
  });

  test("skips when the repository owner is not a safe GitHub path segment", async () => {
    const result = await performAutoCreatePr({
      ...makeParams(),
      repoOwner: 'acme" && echo nope && "',
    });

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason:
        "Repository owner or name is not supported for auto PR creation",
    } satisfies AutoCreatePrResult);
    expect(execSpy).toHaveBeenCalledTimes(1);
  });

  test("skips when the current branch is not available on origin", async () => {
    execResults.set("git ls-remote --heads origin", {
      success: true,
      stdout: "",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is not available on origin",
    } satisfies AutoCreatePrResult);
    expect(generatePullRequestContentFromSandboxSpy).not.toHaveBeenCalled();
  });

  test("skips when the current branch is not fully pushed to origin", async () => {
    execResults.set("git ls-remote --heads origin", {
      success: true,
      stdout: "def456\trefs/heads/feature-branch",
    });

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is not fully pushed to origin",
    } satisfies AutoCreatePrResult);
    expect(findPullRequestSpy).not.toHaveBeenCalled();
    expect(openPullRequestSpy).not.toHaveBeenCalled();
  });

  test("syncs an existing open pull request instead of creating a new one", async () => {
    findPullRequestResult = {
      found: true,
      prNumber: 7,
      prStatus: "open",
      prUrl: "https://github.com/acme/repo/pull/7",
    };

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: true,
      skipped: false,
      prNumber: 7,
      prUrl: "https://github.com/acme/repo/pull/7",
    } satisfies AutoCreatePrResult);
    expect(updateSessionSpy).toHaveBeenCalledWith("session-1", {
      prNumber: 7,
      prStatus: "open",
    });
    expect(openPullRequestSpy).not.toHaveBeenCalled();
  });

  test("creates a new pull request and persists PR metadata", async () => {
    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: true,
      syncedExisting: false,
      skipped: false,
      prNumber: 42,
      prUrl: "https://github.com/acme/repo/pull/42",
    } satisfies AutoCreatePrResult);
    expect(getGitHubAppUserTokenSpy).toHaveBeenCalledWith("user-1");
    expect(getUserGitHubTokenSpy).toHaveBeenCalledWith("user-1");
    expect(verifyRepoAccessSpy).toHaveBeenCalledWith({
      userId: "user-1",
      owner: "acme",
      repo: "repo",
    });
    expect(mintInstallationTokenSpy).toHaveBeenCalledWith({
      installationId: 999,
      repositoryIds: [123],
      permissions: { contents: "read" },
    });
    expect(withTemporaryGitHubAuthSpy).toHaveBeenCalledWith(
      sandbox,
      "ghs_read",
      expect.any(Function),
    );
    expect(revokeInstallationTokenSpy).toHaveBeenCalledWith("ghs_read");
    expect(generatePullRequestContentFromSandboxSpy).toHaveBeenCalledTimes(1);
    expect(openPullRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: "https://github.com/acme/repo",
        branchName: "feature-branch",
        baseBranch: "main",
        token: "ghu_user",
      }),
    );
    expect(updateSessionSpy).toHaveBeenCalledWith("session-1", {
      prNumber: 42,
      prStatus: "open",
    });
  });

  test("returns an error when PR content generation fails unexpectedly", async () => {
    prContentResult = {
      success: false,
      error: "Failed to resolve the repository default branch",
    };

    const result = await performAutoCreatePr(makeParams());

    expect(result).toEqual({
      created: false,
      syncedExisting: false,
      skipped: false,
      error: "Failed to resolve the repository default branch",
    } satisfies AutoCreatePrResult);
    expect(openPullRequestSpy).not.toHaveBeenCalled();
  });
});
