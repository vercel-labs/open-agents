import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type DiscardRequest = {
  filePath?: string;
  oldPath?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toGitErrorMessage(result: {
  stderr?: string;
  stdout?: string;
}): string {
  return result.stderr?.trim() || result.stdout?.trim() || "Git command failed";
}

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

async function ensurePathHasUncommittedChanges(params: {
  cwd: string;
  path: string;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { cwd, path, sandbox } = params;
  const statusResult = await sandbox.exec(
    `git status --porcelain=v1 -- ${shellQuote(path)}`,
    cwd,
    10000,
  );
  if (!statusResult.success) {
    return {
      ok: false,
      error: toGitErrorMessage(statusResult),
      status: 500,
    };
  }

  if (statusResult.stdout.trim().length === 0) {
    return {
      ok: false,
      error: "Path has no uncommitted changes",
      status: 404,
    };
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

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(parsedBody)) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body: DiscardRequest = parsedBody;
  const hasFilePathField = typeof body.filePath !== "undefined";
  const hasOldPathField = typeof body.oldPath !== "undefined";
  const filePath =
    typeof body.filePath === "string" ? body.filePath : undefined;
  const oldPath = typeof body.oldPath === "string" ? body.oldPath : undefined;
  const targetPaths = Array.from(
    new Set([filePath, oldPath].filter(isNonEmptyString)),
  );

  if (hasFilePathField && !isNonEmptyString(filePath)) {
    return Response.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (hasOldPathField && !isNonEmptyString(oldPath)) {
    return Response.json({ error: "Invalid old file path" }, { status: 400 });
  }

  if (!filePath && oldPath) {
    return Response.json(
      { error: "filePath is required when oldPath is provided" },
      { status: 400 },
    );
  }

  if (filePath && !isValidRepoRelativePath(filePath)) {
    return Response.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (oldPath && !isValidRepoRelativePath(oldPath)) {
    return Response.json({ error: "Invalid old file path" }, { status: 400 });
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before discarding changes",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const sandboxState = sessionContext.sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    const repoResult = await sandbox.exec(
      "git rev-parse --show-toplevel",
      cwd,
      10000,
    );
    if (!repoResult.success) {
      return Response.json(
        { error: "Sandbox working directory is not a git repository" },
        { status: 400 },
      );
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
          return Response.json(
            { error: statusCheck.error },
            { status: statusCheck.status },
          );
        }

        const result = await discardPathChanges({
          cwd,
          path: targetPath,
          hasHead,
          sandbox,
        });
        if (!result.ok) {
          return Response.json({ error: result.error }, { status: 500 });
        }
      }
    } else if (hasHead) {
      const resetResult = await sandbox.exec(
        "git reset --hard HEAD",
        cwd,
        30000,
      );
      if (!resetResult.success) {
        return Response.json(
          { error: toGitErrorMessage(resetResult) },
          { status: 500 },
        );
      }
    } else {
      const clearIndexResult = await sandbox.exec(
        "git rm -rf --cached .",
        cwd,
        30000,
      );
      const clearIndexError = toGitErrorMessage(clearIndexResult);
      if (!clearIndexResult.success && !isPathspecError(clearIndexError)) {
        return Response.json({ error: clearIndexError }, { status: 500 });
      }
    }

    if (!filePath) {
      const cleanResult = await sandbox.exec("git clean -fd", cwd, 30000);
      if (!cleanResult.success) {
        return Response.json(
          { error: toGitErrorMessage(cleanResult) },
          { status: 500 },
        );
      }
    }

    const statusCommand = filePath
      ? `git status --porcelain -- ${targetPaths
          .map((path) => shellQuote(path))
          .join(" ")}`
      : "git status --porcelain";
    const statusResult = await sandbox.exec(statusCommand, cwd, 10000);
    if (!statusResult.success) {
      return Response.json(
        { error: toGitErrorMessage(statusResult) },
        { status: 500 },
      );
    }

    return Response.json({
      discarded: true,
      hasUncommittedChanges: statusResult.stdout.trim().length > 0,
    });
  } catch (error) {
    console.error("Failed to discard uncommitted changes:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
