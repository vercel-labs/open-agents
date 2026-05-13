import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── spy state ──────────────────────────────────────────────────────

let hasChanges = true;
let stageFails = false;
let stagedDiff = "diff --git a/file.ts...";
let changedFiles = [
  {
    path: "file.ts",
    status: "modified" as const,
    content: "export const x = 1;",
    encoding: "utf-8" as const,
  },
];
let verifyResult:
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
    }
  | { ok: false; reason: string } = {
  ok: true,
  installationId: 999,
  repositoryId: 123,
  defaultBranch: "main",
};
let coAuthorResult: { name: string; email: string } | null = {
  name: "octocat",
  email: "12345+octocat@users.noreply.github.com",
};
let apiCommitResult:
  | { ok: true; commitSha: string }
  | { ok: false; error: string } = {
  ok: true,
  commitSha: "abc123def456",
};
let generateTextResult = { text: "feat: implement new feature" };
let syncPreservingChangesCalls = 0;

// ── module mocks ───────────────────────────────────────────────────

mock.module("server-only", () => ({}));

mock.module("ai", () => ({
  generateText: async () => generateTextResult,
}));

mock.module("@open-agents/agent", () => ({
  gateway: () => "mock-model",
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
  hasUncommittedChanges: async () => hasChanges,
  stageAll: async () => {
    if (stageFails) throw new Error("staging failed");
  },
  getStagedDiff: async () => stagedDiff,
  getChangedFiles: async () =>
    changedFiles.map(({ path, status }) => ({ path, status })),
  detectBinaryFiles: async () => new Set<string>(),
  getFileModes: async () => new Map([["file.ts", "100644"]]),
  getHeadSha: async () => "base-sha",
  getCurrentBranch: async () => "feature-branch",
  syncToRemote: async () => {},
  syncToRemotePreservingChanges: async () => {
    syncPreservingChangesCalls += 1;
  },
  withTemporaryGitHubAuth: async (
    _sandbox: unknown,
    _token: string | undefined,
    operation: () => Promise<unknown>,
  ) => operation(),
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => null,
  updateSession: async () => {},
}));

mock.module("@/lib/github/access", () => ({
  verifyRepoAccess: async () => verifyResult,
  getRepoAccessErrorMessage: () => "Access denied",
}));

mock.module("@/lib/github/commit", () => ({
  createCommit: async () => apiCommitResult,
  buildCoAuthor: async () => coAuthorResult,
  buildCommitMessageWithCoAuthor: (
    message: string,
    coAuthor?: { name: string; email: string },
  ) =>
    coAuthor
      ? `${message}\n\nCo-Authored-By: ${coAuthor.name} <${coAuthor.email}>`
      : message,
}));

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit: async ({
    operation,
  }: {
    operation: (octokit: Record<string, never>) => Promise<unknown>;
  }) => operation({}),
  mintInstallationToken: async () => ({
    token: "read-token",
    expiresAt: null,
    installationId: 999,
    repositoryIds: [123],
    permissions: { contents: "read" },
  }),
  revokeInstallationToken: async () => {},
}));

const { performAutoCommit } = await import("./auto-commit-direct");

// ── helpers ────────────────────────────────────────────────────────

function makeParams() {
  return {
    sandbox: {
      workingDirectory: "/sandbox",
      readFile: async () => changedFiles[0]?.content ?? "",
      readFileBuffer: async () => Buffer.from(changedFiles[0]?.content ?? ""),
      exec: async () => ({ success: true, stdout: "" }),
    } as never,
    userId: "user-1",
    sessionId: "session-1",
    sessionTitle: "Fix bug",
    repoOwner: "acme",
    repoName: "repo",
  };
}

// ── tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  hasChanges = true;
  stageFails = false;
  stagedDiff = "diff --git a/file.ts...";
  changedFiles = [
    {
      path: "file.ts",
      status: "modified",
      content: "export const x = 1;",
      encoding: "utf-8",
    },
  ];
  verifyResult = {
    ok: true,
    installationId: 999,
    repositoryId: 123,
    defaultBranch: "main",
  };
  coAuthorResult = {
    name: "octocat",
    email: "12345+octocat@users.noreply.github.com",
  };
  apiCommitResult = { ok: true, commitSha: "abc123def456" };
  generateTextResult = { text: "feat: implement new feature" };
  syncPreservingChangesCalls = 0;
});

describe("performAutoCommit", () => {
  test("returns early with no commit when no changes", async () => {
    hasChanges = false;

    const result = await performAutoCommit(makeParams());

    expect(result).toEqual({ committed: false, pushed: false });
  });

  test("returns error when staging fails", async () => {
    stageFails = true;

    const result = await performAutoCommit(makeParams());

    expect(result).toEqual({
      committed: false,
      pushed: false,
      error: "Failed to stage changes",
    });
  });

  test("returns error when repo access verification fails", async () => {
    verifyResult = { ok: false, reason: "no_installation" };

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(false);
    expect(result.error).toContain("no_installation");
  });

  test("returns error when api commit fails", async () => {
    apiCommitResult = { ok: false, error: "Concurrent push detected" };

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(false);
    expect(result.error).toBe("Concurrent push detected");
  });

  test("full success path returns all fields", async () => {
    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.commitMessage).toBeDefined();
    expect(result.commitSha).toBe("abc123def456");
    expect(result.error).toBeUndefined();
    expect(syncPreservingChangesCalls).toBe(1);
  });

  test("uses fallback commit message when diff is empty", async () => {
    stagedDiff = "";

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toBe("chore: update repository changes");
  });

  test("truncates generated commit message to 72 chars", async () => {
    generateTextResult = { text: "A".repeat(100) };

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(true);
    expect(result.commitMessage!.length).toBeLessThanOrEqual(72);
  });

  test("returns early when no changed files after staging", async () => {
    changedFiles = [];

    const result = await performAutoCommit(makeParams());

    expect(result).toEqual({ committed: false, pushed: false });
  });
});
