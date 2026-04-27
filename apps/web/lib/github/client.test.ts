import { beforeEach, describe, expect, mock, test } from "bun:test";

type MockPullRequest = {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  title: string;
  body: string | null;
  base: { ref: string };
  head: {
    ref: string;
    sha: string;
    repo: { owner: { login: string } } | null;
  };
  mergeable: boolean | null;
  mergeable_state: string | null;
};

type MockCheckRun = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  details_url?: string | null;
};

type MockStatus = {
  state: string;
  context: string | null;
  target_url?: string | null;
};

const mockState: {
  pullRequestResponses: MockPullRequest[];
  repositoryResponse: {
    allow_squash_merge: boolean;
    allow_merge_commit: boolean;
    allow_rebase_merge: boolean;
  };
  checkRuns: MockCheckRun[];
  statuses: MockStatus[];
  requiredContexts: string[];
  mergeError: unknown;
  mergeResponseSha: string;
} = {
  pullRequestResponses: [],
  repositoryResponse: {
    allow_squash_merge: true,
    allow_merge_commit: true,
    allow_rebase_merge: true,
  },
  checkRuns: [],
  statuses: [],
  requiredContexts: [],
  mergeError: null,
  mergeResponseSha: "merged-sha",
};

function createMockPullRequest(
  overrides: Partial<MockPullRequest> = {},
): MockPullRequest {
  return {
    number: 42,
    state: "open",
    draft: false,
    title: "Test PR",
    body: null,
    base: { ref: "main" },
    head: {
      ref: "feature/test",
      sha: "abc1234",
      repo: { owner: { login: "acme" } },
    },
    mergeable: true,
    mergeable_state: "clean",
    ...overrides,
  };
}

function resetMockState() {
  mockState.pullRequestResponses = [createMockPullRequest()];
  mockState.repositoryResponse = {
    allow_squash_merge: true,
    allow_merge_commit: true,
    allow_rebase_merge: true,
  };
  mockState.checkRuns = [];
  mockState.statuses = [];
  mockState.requiredContexts = [];
  mockState.mergeError = null;
  mockState.mergeResponseSha = "merged-sha";
}

class MockOctokit {
  rest = {
    pulls: {
      get: async ({ pull_number }: { pull_number: number }) => {
        const response =
          mockState.pullRequestResponses.shift() ?? createMockPullRequest();
        return {
          data: {
            ...response,
            number: pull_number,
          },
        };
      },
      merge: async () => {
        if (mockState.mergeError) {
          throw mockState.mergeError;
        }

        return {
          data: {
            sha: mockState.mergeResponseSha,
          },
        };
      },
    },
    repos: {
      get: async () => ({
        data: mockState.repositoryResponse,
      }),
      getCombinedStatusForRef: async () => ({
        data: {
          statuses: mockState.statuses,
        },
      }),
      getStatusChecksProtection: async () => ({
        data: {
          contexts: mockState.requiredContexts,
        },
      }),
    },
    checks: {
      listForRef: async () => ({
        data: {
          check_runs: mockState.checkRuns,
        },
      }),
    },
  };

  graphql = mock(async () => ({}));
}

mock.module("@octokit/rest", () => ({
  Octokit: MockOctokit,
}));

mock.module("./user-token", () => ({
  getUserGitHubToken: async () => "token-from-mock",
}));

let moduleVersion = 0;

async function loadClientModule() {
  moduleVersion += 1;
  return import(`./pulls?test=${moduleVersion}`);
}

describe("github client merge readiness", () => {
  beforeEach(() => {
    resetMockState();
  });

  test("adds missing required contexts as expected pending checks", async () => {
    mockState.pullRequestResponses = [
      createMockPullRequest({
        mergeable: true,
        mergeable_state: "blocked",
      }),
    ];
    mockState.checkRuns = [
      {
        id: 1,
        name: "lint-and-typecheck",
        status: "completed",
        conclusion: "success",
      },
    ];
    mockState.requiredContexts = ["lint-and-typecheck", "Vercel"];

    const { getMergeReadiness } = await loadClientModule();
    const readiness = await getMergeReadiness({
      repoUrl: "https://github.com/acme/rocket.git",
      prNumber: 42,
      token: "token-123",
    });

    expect(readiness.success).toBe(true);
    expect(readiness.canMerge).toBe(false);
    expect(readiness.checks).toEqual({
      requiredTotal: 2,
      passed: 1,
      pending: 1,
      failed: 0,
    });
    expect(
      readiness.checkRuns?.map((checkRun: { name: string }) => checkRun.name),
    ).toEqual(["lint-and-typecheck", "Vercel"]);
    expect(readiness.checkRuns?.[1]).toMatchObject({
      state: "pending",
      status: "expected",
      conclusion: null,
    });
    expect(readiness.reasons).toContain("Required checks are still pending");
  });

  test("retries stale blocked mergeability after all required checks pass", async () => {
    mockState.pullRequestResponses = [
      createMockPullRequest({
        mergeable: true,
        mergeable_state: "blocked",
      }),
      createMockPullRequest({
        mergeable: true,
        mergeable_state: "clean",
      }),
    ];
    mockState.checkRuns = [
      {
        id: 1,
        name: "Vercel",
        status: "completed",
        conclusion: "success",
      },
    ];
    mockState.requiredContexts = ["Vercel"];

    const { getMergeReadiness } = await loadClientModule();
    const readiness = await getMergeReadiness({
      repoUrl: "https://github.com/acme/rocket.git",
      prNumber: 42,
      token: "token-123",
    });

    expect(readiness.success).toBe(true);
    expect(readiness.canMerge).toBe(true);
    expect(readiness.reasons).toEqual([]);
    expect(readiness.pr?.mergeableState).toBe("clean");
  });

  test("surfaces GitHub's specific 405 merge rule message", async () => {
    mockState.mergeError = {
      status: 405,
      response: {
        data: {
          message:
            'Repository rule violations found\n\nRequired status check "Vercel" is expected.',
        },
      },
    };

    const { mergePullRequest } = await loadClientModule();
    const result = await mergePullRequest({
      repoUrl: "https://github.com/acme/rocket.git",
      prNumber: 42,
      token: "token-123",
    });

    expect(result).toEqual({
      success: false,
      error:
        'Repository rule violations found\n\nRequired status check "Vercel" is expected.',
      statusCode: 405,
    });
  });
});
