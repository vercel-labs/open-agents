import type { ExecResult, Sandbox } from "./interface";

// ---- types ----

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  /** original path for renamed files */
  oldPath?: string;
}

export interface FileWithContent extends FileChange {
  content: string;
  encoding: "utf-8" | "base64";
}

function isSafeBranchName(branch: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock")
  );
}

// ---- helpers ----

function exec(
  sandbox: Sandbox,
  command: string,
  timeoutMs = 30000,
): Promise<ExecResult> {
  return sandbox.exec(command, sandbox.workingDirectory, timeoutMs);
}

function commandOutput(result: ExecResult): string {
  return result.stderr?.trim() || result.stdout?.trim() || "Git command failed";
}

function isMissingRemoteRef(result: ExecResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`;
  return output.includes("couldn't find remote ref");
}

async function fetchRemoteBranch(
  sandbox: Sandbox,
  branch: string,
): Promise<"fetched" | "missing"> {
  const fetchResult = await exec(
    sandbox,
    `GIT_TERMINAL_PROMPT=0 git fetch --force origin ${branch}:refs/remotes/origin/${branch}`,
    30000,
  );

  if (fetchResult.success) {
    return "fetched";
  }

  if (isMissingRemoteRef(fetchResult)) {
    return "missing";
  }

  throw new Error(
    `Failed to fetch remote branch: ${commandOutput(fetchResult)}`,
  );
}

async function resetToFetchedRemoteBranch(
  sandbox: Sandbox,
  branch: string,
): Promise<void> {
  const resetResult = await exec(
    sandbox,
    `git reset --hard origin/${branch}`,
    10000,
  );
  if (!resetResult.success) {
    throw new Error(
      `Failed to reset to remote branch: ${commandOutput(resetResult)}`,
    );
  }

  const upstreamResult = await exec(
    sandbox,
    `git branch --set-upstream-to=origin/${branch} ${branch}`,
    10000,
  );
  if (!upstreamResult.success) {
    throw new Error(
      `Failed to set upstream after remote sync: ${commandOutput(upstreamResult)}`,
    );
  }
}

async function getCurrentHead(sandbox: Sandbox): Promise<string> {
  const headResult = await exec(sandbox, "git rev-parse HEAD", 10000);
  if (!headResult.success) {
    throw new Error(
      `Failed to inspect current HEAD: ${commandOutput(headResult)}`,
    );
  }

  return headResult.stdout.trim();
}

async function resetToCommit(sandbox: Sandbox, commit: string): Promise<void> {
  const resetResult = await exec(sandbox, `git reset --hard ${commit}`, 10000);
  if (!resetResult.success) {
    throw new Error(
      `Failed to restore original HEAD after sync failure: ${commandOutput(resetResult)}`,
    );
  }

  const cleanResult = await exec(sandbox, "git clean -fd", 10000);
  if (!cleanResult.success) {
    throw new Error(
      `Failed to clean worktree after sync failure: ${commandOutput(cleanResult)}`,
    );
  }
}

// ---- public functions ----

/**
 * Check whether the sandbox has uncommitted changes.
 */
export async function hasUncommittedChanges(
  sandbox: Sandbox,
): Promise<boolean> {
  const result = await exec(sandbox, "git status --porcelain", 10000);
  return result.success && result.stdout.trim().length > 0;
}

/**
 * Stage all changes in the sandbox working directory.
 */
export async function stageAll(sandbox: Sandbox): Promise<void> {
  const result = await exec(sandbox, "git add -A", 10000);
  if (!result.success) {
    throw new Error(`Failed to stage changes: ${result.stdout}`);
  }
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(sandbox: Sandbox): Promise<string> {
  const result = await exec(sandbox, "git symbolic-ref --short HEAD", 5000);
  return result.stdout.trim() || "HEAD";
}

/**
 * Get the HEAD commit SHA.
 */
export async function getHeadSha(sandbox: Sandbox): Promise<string> {
  const result = await exec(sandbox, "git rev-parse HEAD", 5000);
  return result.stdout.trim();
}

/**
 * Get the staged diff (for commit message generation).
 */
export async function getStagedDiff(sandbox: Sandbox): Promise<string> {
  const result = await exec(sandbox, "git diff --cached", 30000);
  return result.stdout;
}

/**
 * Parse the staged changes into a list of file changes.
 * Uses NUL separators for reliable filename parsing.
 */
export async function getChangedFiles(sandbox: Sandbox): Promise<FileChange[]> {
  const result = await exec(
    sandbox,
    "git diff --cached --name-status -z HEAD",
    15000,
  );

  if (!result.success || !result.stdout.trim()) {
    return [];
  }

  const changes: FileChange[] = [];
  const parts = result.stdout.split("\0").filter(Boolean);

  let i = 0;
  while (i < parts.length) {
    const statusField = parts[i];
    if (!statusField) break;

    const statusChar = statusField[0];

    if (statusChar === "R" || statusChar === "C") {
      // renamed/copied: status, old path, new path
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (oldPath && newPath) {
        changes.push({
          path: newPath,
          status: "renamed",
          oldPath,
        });
      }
      i += 3;
    } else {
      const path = parts[i + 1];
      if (path) {
        let status: FileChangeStatus;
        if (statusChar === "A") {
          status = "added";
        } else if (statusChar === "D") {
          status = "deleted";
        } else {
          status = "modified";
        }
        changes.push({ path, status });
      }
      i += 2;
    }
  }

  return changes;
}

/**
 * Detect which files are binary using git's numstat output.
 * Binary files show "-" for both additions and deletions.
 */
export async function detectBinaryFiles(
  sandbox: Sandbox,
): Promise<Set<string>> {
  const result = await exec(
    sandbox,
    "git diff --cached --numstat -z HEAD",
    15000,
  );

  const binaryPaths = new Set<string>();
  if (!result.success || !result.stdout.trim()) {
    return binaryPaths;
  }

  // numstat with -z: "additions\tdeletions\tpath\0"
  // binary files show: "-\t-\tpath\0"
  const lines = result.stdout.split("\0").filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("-\t-\t")) {
      const path = line.slice(4);
      if (path) {
        binaryPaths.add(path);
      }
    }
  }

  return binaryPaths;
}

/**
 * Read the contents of changed files from the sandbox.
 * Binary files are read as base64, text files as utf-8.
 * Deleted files are excluded (no content to read).
 */
export async function readFileContents(
  sandbox: Sandbox,
  changes: FileChange[],
): Promise<FileWithContent[]> {
  const binaryFiles = await detectBinaryFiles(sandbox);
  const cwd = sandbox.workingDirectory;

  const results: FileWithContent[] = [];

  for (const change of changes) {
    if (change.status === "deleted") {
      results.push({ ...change, content: "", encoding: "utf-8" });
      continue;
    }

    const fullPath = `${cwd}/${change.path}`;

    if (binaryFiles.has(change.path)) {
      const buffer = await sandbox.readFileBuffer(fullPath);
      results.push({
        ...change,
        content: buffer.toString("base64"),
        encoding: "base64",
      });
    } else {
      const content = await sandbox.readFile(fullPath, "utf-8");
      results.push({ ...change, content, encoding: "utf-8" });
    }
  }

  return results;
}

/**
 * Get file modes from the staging area (handles executable files).
 * Returns a map of path → mode string (e.g. "100644", "100755").
 */
export async function getFileModes(
  sandbox: Sandbox,
): Promise<Map<string, string>> {
  const result = await exec(sandbox, "git ls-files --stage", 15000);

  const modes = new Map<string, string>();
  if (!result.success) return modes;

  for (const line of result.stdout.split("\n")) {
    // format: "mode sha stage\tpath"
    const match = line.match(/^(\d+)\s+\S+\s+\d+\t(.+)$/);
    if (match && match[1] && match[2]) {
      modes.set(match[2], match[1]);
    }
  }

  return modes;
}

/**
 * Sync the sandbox working tree to match the remote branch.
 * Call this after creating a commit via the GitHub API.
 */
export async function syncToRemote(
  sandbox: Sandbox,
  branch: string,
): Promise<void> {
  if (!isSafeBranchName(branch)) {
    throw new Error("Invalid branch name");
  }

  const fetchStatus = await fetchRemoteBranch(sandbox, branch);
  if (fetchStatus === "missing") {
    throw new Error(`Remote branch '${branch}' not found`);
  }

  await resetToFetchedRemoteBranch(sandbox, branch);
}

/**
 * Refresh the sandbox branch from remote before building an API commit.
 * Local edits are stashed and restored so commits are based on the latest
 * remote head even when a previous broker-created commit was not synced back.
 */
export async function syncToRemotePreservingChanges(
  sandbox: Sandbox,
  branch: string,
): Promise<void> {
  if (!isSafeBranchName(branch)) {
    throw new Error("Invalid branch name");
  }

  const fetchStatus = await fetchRemoteBranch(sandbox, branch);
  if (fetchStatus === "missing") {
    return;
  }

  const statusResult = await exec(sandbox, "git status --porcelain", 10000);
  if (!statusResult.success) {
    throw new Error(
      `Failed to inspect local changes: ${commandOutput(statusResult)}`,
    );
  }

  const hasLocalChanges = statusResult.stdout.trim().length > 0;
  if (!hasLocalChanges) {
    await resetToFetchedRemoteBranch(sandbox, branch);
    return;
  }

  const originalHead = await getCurrentHead(sandbox);

  const stashResult = await exec(
    sandbox,
    "git stash push --include-untracked -m open-agents-pre-commit-sync",
    30000,
  );
  if (!stashResult.success) {
    throw new Error(
      `Failed to stash local changes: ${commandOutput(stashResult)}`,
    );
  }

  try {
    await resetToFetchedRemoteBranch(sandbox, branch);
  } catch (error) {
    await resetToCommit(sandbox, originalHead);
    await exec(sandbox, "git stash pop", 30000).catch(() => {});
    throw error;
  }

  const popResult = await exec(sandbox, "git stash pop", 30000);
  if (!popResult.success) {
    await resetToCommit(sandbox, originalHead);
    const restoreResult = await exec(sandbox, "git stash pop", 30000);
    if (!restoreResult.success) {
      throw new Error(
        `Failed to restore local changes after rolling back sync failure: ${commandOutput(restoreResult)}`,
      );
    }

    throw new Error(
      `Failed to restore local changes after syncing remote branch: ${commandOutput(popResult)}`,
    );
  }
}

export async function withTemporaryGitHubAuth<T>(
  sandbox: Sandbox,
  token: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!token) {
    return operation();
  }

  if (!sandbox.setGitHubAuthToken) {
    throw new Error("Sandbox does not support temporary GitHub auth");
  }

  await sandbox.setGitHubAuthToken(token);
  try {
    return await operation();
  } finally {
    await sandbox.setGitHubAuthToken(undefined);
  }
}
