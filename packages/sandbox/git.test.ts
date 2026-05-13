import { describe, expect, test } from "bun:test";
import type { ExecResult, Sandbox } from "./interface";
import { syncToRemotePreservingChanges } from "./git";

function result(params: Partial<ExecResult> = {}): ExecResult {
  return {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    truncated: false,
    ...params,
  };
}

function createSandbox(results: ExecResult[]): Sandbox {
  const commands: string[] = [];

  return {
    type: "cloud",
    workingDirectory: "/repo",
    exec: async (command) => {
      commands.push(command);
      return results.shift() ?? result();
    },
    readFile: async () => "",
    writeFile: async () => {},
    readFileBuffer: async () => Buffer.from(""),
    access: async () => {},
    stat: async () => ({
      isDirectory: () => false,
      isFile: () => true,
      size: 0,
      mtimeMs: 0,
    }),
    mkdir: async () => {},
    readdir: async () => [],
    exists: async () => true,
    stop: async () => {},
    commands,
  } as Sandbox & { commands: string[] };
}

describe("syncToRemotePreservingChanges", () => {
  test("stashes local changes, resets to remote, and restores changes", async () => {
    const sandbox = createSandbox([
      result(),
      result({ stdout: " M file.ts\n" }),
      result({ stdout: "original-head\n" }),
      result(),
      result(),
      result(),
      result(),
    ]) as Sandbox & { commands: string[] };

    await syncToRemotePreservingChanges(sandbox, "feature");

    expect(sandbox.commands).toEqual([
      "git fetch origin feature:refs/remotes/origin/feature",
      "git status --porcelain",
      "git rev-parse HEAD",
      "git stash push --include-untracked -m open-agents-pre-commit-sync",
      "git reset --hard origin/feature",
      "git branch --set-upstream-to=origin/feature feature",
      "git stash pop",
    ]);
  });

  test("returns without touching local changes when the remote branch is missing", async () => {
    const sandbox = createSandbox([
      result({
        success: false,
        exitCode: 128,
        stderr: "fatal: couldn't find remote ref feature\n",
      }),
    ]) as Sandbox & { commands: string[] };

    await syncToRemotePreservingChanges(sandbox, "feature");

    expect(sandbox.commands).toEqual([
      "git fetch origin feature:refs/remotes/origin/feature",
    ]);
  });

  test("rolls back and restores local changes when stash restore conflicts after sync", async () => {
    const sandbox = createSandbox([
      result(),
      result({ stdout: " M file.ts\n" }),
      result({ stdout: "original-head\n" }),
      result(),
      result(),
      result(),
      result({
        success: false,
        exitCode: 1,
        stderr: "CONFLICT (content): Merge conflict in file.ts\n",
      }),
      result(),
      result(),
      result(),
    ]) as Sandbox & { commands: string[] };

    await expect(
      syncToRemotePreservingChanges(sandbox, "feature"),
    ).rejects.toThrow(
      "Failed to restore local changes after syncing remote branch",
    );

    expect(sandbox.commands).toEqual([
      "git fetch origin feature:refs/remotes/origin/feature",
      "git status --porcelain",
      "git rev-parse HEAD",
      "git stash push --include-untracked -m open-agents-pre-commit-sync",
      "git reset --hard origin/feature",
      "git branch --set-upstream-to=origin/feature feature",
      "git stash pop",
      "git reset --hard original-head",
      "git clean -fd",
      "git stash pop",
    ]);
  });
});
