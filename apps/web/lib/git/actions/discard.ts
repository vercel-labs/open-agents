"use server";

import { connectSandbox } from "@open-agents/sandbox";
import { getSessionById } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isPathspecError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("pathspec") &&
    normalized.includes("did not match any files")
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidRepoRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\0")) {
    return false;
  }

  return value.split("/").every((segment) => {
    return (
      segment !== "" &&
      segment !== "." &&
      segment !== ".." &&
      segment !== ".git"
    );
  });
}

function toGitErrorMessage(result: {
  stderr?: string;
  stdout?: string;
}): string {
  return result.stderr?.trim() || result.stdout?.trim() || "Git command failed";
}

async function ensurePathHasUncommittedChanges(params: {
  cwd: string;
  path: string;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { cwd, path, sandbox } = params;
  const statusResult = await sandbox.exec(
    `git status --porcelain=v1 -- ${shellQuote(path)}`,
    cwd,
    10000,
  );
  if (!statusResult.success) {
    return { ok: false, error: toGitErrorMessage(statusResult) };
  }

  if (statusResult.stdout.trim().length === 0) {
    return { ok: false, error: "Path has no uncommitted changes" };
  }

  return { ok: true };
}

async function discardPathChanges(params: {
  cwd: string;
  path: string;
  hasHead: boolean;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { cwd, path, hasHead, sandbox } = params;
  const quotedPath = shellQuote(path);
  const trackedResult = await sandbox.exec(
    `git ls-files --error-unmatch -- ${quotedPath}`,
    cwd,
    10000,
  );

  if (trackedResult.success) {
    if (hasHead) {
      const restoreResult = await sandbox.exec(
        `git restore --source=HEAD --staged --worktree -- ${quotedPath}`,
        cwd,
        30000,
      );
      if (!restoreResult.success) {
        return { ok: false, error: toGitErrorMessage(restoreResult) };
      }
      return { ok: true };
    }

    const clearIndexResult = await sandbox.exec(
      `git rm -rf --cached -- ${quotedPath}`,
      cwd,
      30000,
    );
    const clearIndexError = toGitErrorMessage(clearIndexResult);
    if (!clearIndexResult.success && !isPathspecError(clearIndexError)) {
      return { ok: false, error: clearIndexError };
    }
  }

  const removeResult = await sandbox.exec(
    `rm -rf -- ${quotedPath}`,
    cwd,
    30000,
  );
  if (!removeResult.success) {
    return { ok: false, error: toGitErrorMessage(removeResult) };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// server action
// ---------------------------------------------------------------------------

/**
 * Discard uncommitted changes in the session sandbox.
 */
export async function discardChanges(params: {
  sessionId: string;
  filePath?: string;
  oldPath?: string;
}): Promise<{ discarded: boolean; hasUncommittedChanges: boolean }> {
  const { sessionId, filePath, oldPath } = params;

  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== session.user.id) {
    throw new Error("Forbidden");
  }
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    throw new Error("Sandbox not initialized");
  }

  // validate paths
  if (filePath !== undefined && !isNonEmptyString(filePath)) {
    throw new Error("Invalid file path");
  }
  if (oldPath !== undefined && !isNonEmptyString(oldPath)) {
    throw new Error("Invalid old file path");
  }
  if (!filePath && oldPath) {
    throw new Error("filePath is required when oldPath is provided");
  }
  if (filePath && !isValidRepoRelativePath(filePath)) {
    throw new Error("Invalid file path");
  }
  if (oldPath && !isValidRepoRelativePath(oldPath)) {
    throw new Error("Invalid old file path");
  }

  const targetPaths = Array.from(
    new Set([filePath, oldPath].filter(isNonEmptyString)),
  );

  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  // verify git repo
  const repoResult = await sandbox.exec(
    "git rev-parse --show-toplevel",
    cwd,
    10000,
  );
  if (!repoResult.success) {
    throw new Error("Sandbox working directory is not a git repository");
  }

  const hasHeadResult = await sandbox.exec(
    "git rev-parse --verify HEAD",
    cwd,
    10000,
  );
  const hasHead = hasHeadResult.success;

  if (filePath) {
    for (const targetPath of targetPaths) {
      const statusCheck = await ensurePathHasUncommittedChanges({
        cwd,
        path: targetPath,
        sandbox,
      });
      if (!statusCheck.ok) {
        throw new Error(statusCheck.error);
      }

      const result = await discardPathChanges({
        cwd,
        path: targetPath,
        hasHead,
        sandbox,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
    }
  } else if (hasHead) {
    const resetResult = await sandbox.exec("git reset --hard HEAD", cwd, 30000);
    if (!resetResult.success) {
      throw new Error(toGitErrorMessage(resetResult));
    }
  } else {
    const clearIndexResult = await sandbox.exec(
      "git rm -rf --cached .",
      cwd,
      30000,
    );
    const clearIndexError = toGitErrorMessage(clearIndexResult);
    if (!clearIndexResult.success && !isPathspecError(clearIndexError)) {
      throw new Error(clearIndexError);
    }
  }

  if (!filePath) {
    const cleanResult = await sandbox.exec("git clean -fd", cwd, 30000);
    if (!cleanResult.success) {
      throw new Error(toGitErrorMessage(cleanResult));
    }
  }

  const statusCommand = filePath
    ? `git status --porcelain -- ${targetPaths
        .map((p) => shellQuote(p))
        .join(" ")}`
    : "git status --porcelain";
  const statusResult = await sandbox.exec(statusCommand, cwd, 10000);
  if (!statusResult.success) {
    throw new Error(toGitErrorMessage(statusResult));
  }

  return {
    discarded: true,
    hasUncommittedChanges: statusResult.stdout.trim().length > 0,
  };
}
