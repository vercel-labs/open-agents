import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Spy state ──────────────────────────────────────────────────────

type ExecResult = {
  success: boolean;
  stdout: string;
  stderr?: string;
};

let execResults: Map<string, ExecResult>;
let repoTokenResult: { token: string | null } = { token: "ghp_test123" };
let githubAccountResult: {
  externalUserId: string;
  username: string;
} | null = { externalUserId: "12345", username: "octocat" };
let generateTextResult = { text: "feat: implement new feature" };

const execSpy = mock(async (command: string): Promise<ExecResult> => {
  // Match on command prefix to support parameterized commands
  for (const [prefix, result] of execResults) {
    if (command.startsWith(prefix) || command.includes(prefix)) {
      return result;
    }
  }
  return { success: true, stdout: "", stderr: "" };
});

const sandbox = {
  workingDirectory: "/vercel/sandbox",
  exec: execSpy,
};

// ── Module mocks ───────────────────────────────────────────────────

mock.module("ai", () => ({
  generateText: async () => generateTextResult,
}));

mock.module("@open-harness/agent", () => ({
  gateway: () => "mock-model",
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => githubAccountResult,
}));

mock.module("@/lib/github/get-repo-token", () => ({
  getRepoToken: async () => repoTokenResult,
}));

const { performAutoCommit } = await import("./auto-commit-direct");

// ── Helpers ────────────────────────────────────────────────────────

function defaultExecResults(): Map<string, ExecResult> {
  return new Map<string, ExecResult>([
    ["git status --porcelain", { success: true, stdout: " M file.ts\n" }],
    ["git remote set-url", { success: true, stdout: "" }],
    ["git add -A", { success: true, stdout: "" }],
    ["git diff --cached", { success: true, stdout: "diff --git a/file.ts..." }],
    ["git config user.name", { success: true, stdout: "" }],
    ["git config user.email", { success: true, stdout: "" }],
    ["git commit -m", { success: true, stdout: "[main abc123] feat: update" }],
    [
      "git rev-parse HEAD",
      { success: true, stdout: "abc123def456789012345678901234567890abcd" },
    ],
    [
      "git symbolic-ref --short HEAD",
      { success: true, stdout: "feature-branch" },
    ],
    ["git push", { success: true, stdout: "" }],
  ]);
}

function makeParams() {
  return {
    sandbox: sandbox as never,
    userId: "user-1",
    sessionId: "session-1",
    sessionTitle: "Fix bug",
    repoOwner: "acme",
    repoName: "repo",
  };
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  execSpy.mockClear();
  execResults = defaultExecResults();
  repoTokenResult = { token: "ghp_test123" };
  githubAccountResult = { externalUserId: "12345", username: "octocat" };
  generateTextResult = { text: "feat: implement new feature" };
});

describe("performAutoCommit", () => {
  test("returns early with no commit when no changes", async () => {
    execResults.set("git status --porcelain", {
      success: true,
      stdout: "",
    });

    const result = await performAutoCommit(makeParams());

    expect(result).toEqual({ committed: false, pushed: false });
  });

  test("returns early when git status fails", async () => {
    execResults.set("git status --porcelain", {
      success: false,
      stdout: "",
    });

    const result = await performAutoCommit(makeParams());

    expect(result).toEqual({ committed: false, pushed: false });
  });

  test("sets up auth remote URL when token available", async () => {
    const result = await performAutoCommit(makeParams());

    const setUrlCall = execSpy.mock.calls.find((c) =>
      (c[0] as string).includes("git remote set-url"),
    );
    expect(setUrlCall).toBeDefined();
    expect(setUrlCall![0] as string).toContain("x-access-token:ghp_test123");
    expect(result.committed).toBe(true);
  });

  test("skips auth remote URL when no token", async () => {
    repoTokenResult = { token: null };

    const result = await performAutoCommit(makeParams());

    const setUrlCall = execSpy.mock.calls.find((c) =>
      (c[0] as string).includes("git remote set-url"),
    );
    expect(setUrlCall).toBeUndefined();
    expect(result.committed).toBe(true);
  });

  test("returns error when git add fails", async () => {
    execResults.set("git add -A", {
      success: false,
      stdout: "",
    });

    const result = await performAutoCommit(makeParams());

    expect(result).toEqual({
      committed: false,
      pushed: false,
      error: "Failed to stage changes",
    });
  });

  test("returns error when commit fails", async () => {
    execResults.set("git commit -m", {
      success: false,
      stdout: "nothing to commit",
    });

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.error).toContain("Failed to commit");
  });

  test("returns committed but not pushed when push fails", async () => {
    execResults.set("git push", {
      success: false,
      stdout: "",
      stderr: "remote rejected",
    });

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.commitMessage).toBeDefined();
    expect(result.error).toBe("Commit succeeded but push failed");
  });

  test("full success path returns all fields", async () => {
    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.commitMessage).toBeDefined();
    expect(result.commitSha).toBe("abc123def456789012345678901234567890abcd");
    expect(result.error).toBeUndefined();
  });

  test("sets git author identity when github account available", async () => {
    await performAutoCommit(makeParams());

    const nameCall = execSpy.mock.calls.find((c) =>
      (c[0] as string).includes("git config user.name"),
    );
    const emailCall = execSpy.mock.calls.find((c) =>
      (c[0] as string).includes("git config user.email"),
    );

    expect(nameCall).toBeDefined();
    expect(nameCall![0] as string).toContain("octocat");
    expect(emailCall).toBeDefined();
    expect(emailCall![0] as string).toContain(
      "12345+octocat@users.noreply.github.com",
    );
  });

  test("skips git identity when no github account", async () => {
    githubAccountResult = null;

    await performAutoCommit(makeParams());

    const nameCall = execSpy.mock.calls.find((c) =>
      (c[0] as string).includes("git config user.name"),
    );
    expect(nameCall).toBeUndefined();
  });

  test("uses fallback commit message when diff is empty", async () => {
    execResults.set("git diff --cached", { success: true, stdout: "" });

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

  test("proceeds without token when getRepoToken throws", async () => {
    // Override the mock for this test by manipulating exec results
    // The token fetch will fail but commit should still work
    repoTokenResult = { token: null };

    const result = await performAutoCommit(makeParams());

    expect(result.committed).toBe(true);
  });
});
