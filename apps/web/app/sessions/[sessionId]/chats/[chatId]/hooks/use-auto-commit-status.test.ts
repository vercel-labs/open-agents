import { describe, expect, test } from "bun:test";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";
import { shouldStartOptimisticAutoCommit } from "./use-auto-commit-status";

function makeGitStatus(
  overrides: Partial<SessionGitStatus> = {},
): SessionGitStatus {
  return {
    branch: "feature/test",
    isDetachedHead: false,
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    uncommittedFiles: 0,
    ...overrides,
  };
}

describe("shouldStartOptimisticAutoCommit", () => {
  test("returns false when auto-commit is disabled", () => {
    expect(
      shouldStartOptimisticAutoCommit(
        false,
        makeGitStatus({ hasUncommittedChanges: true }),
      ),
    ).toBe(false);
  });

  test("returns false when there are no uncommitted changes", () => {
    expect(shouldStartOptimisticAutoCommit(true, makeGitStatus())).toBe(false);
  });

  test("returns false when only unpushed commits remain", () => {
    expect(
      shouldStartOptimisticAutoCommit(
        true,
        makeGitStatus({ hasUnpushedCommits: true }),
      ),
    ).toBe(false);
  });

  test("returns true when uncommitted changes are present", () => {
    expect(
      shouldStartOptimisticAutoCommit(
        true,
        makeGitStatus({ hasUncommittedChanges: true }),
      ),
    ).toBe(true);
  });

  test("returns false when git status is unavailable", () => {
    expect(shouldStartOptimisticAutoCommit(true, null)).toBe(false);
  });
});
