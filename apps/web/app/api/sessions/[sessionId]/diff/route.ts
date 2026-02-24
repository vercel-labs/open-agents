import type { NextRequest } from "next/server";
import { connectSandbox, type Sandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type DiffFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** May be absent in cached diffs created before this field was introduced. */
  stagingStatus?: "staged" | "unstaged" | "partial";
  additions: number;
  deletions: number;
  diff: string;
  oldPath?: string;
  /** True for generated/lock files whose diff content is intentionally omitted. */
  generated?: boolean;
};

export type DiffResponse = {
  files: DiffFile[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  /** The git ref used as the diff base (e.g. "origin/main", "HEAD"). May be absent in old cached diffs. */
  baseRef?: string;
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Unescape C-style escape sequences in git quoted paths
 * Git uses C-style quoting for special chars: \n, \t, \\, \", etc.
 * Handles both fully quoted paths ("path") and already-unquoted escaped content
 */
function unescapeGitPath(path: string): string {
  // If path is surrounded by quotes, strip them first
  if (path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  // For paths captured from inside quotes (e.g., by regex), still unescape
  // For truly unquoted paths (no special chars), this is a no-op
  return path.replace(/\\(.)/g, "$1");
}

/**
 * Parse git diff --name-status output to get file statuses
 * Format: "M\tpath" or "R100\told\tnew" for renames
 * Paths may be quoted if they contain special characters
 */
function parseNameStatus(
  output: string,
): Map<string, { status: DiffFile["status"]; oldPath?: string }> {
  const result = new Map<
    string,
    { status: DiffFile["status"]; oldPath?: string }
  >();

  for (const line of output.trim().split("\n")) {
    if (!line) continue;

    const parts = line.split("\t");
    const statusCode = parts[0];
    if (!statusCode) continue;

    if (statusCode.startsWith("R")) {
      // Rename: R100\told\tnew
      const oldPath = parts[1];
      const newPath = parts[2];
      if (newPath) {
        result.set(unescapeGitPath(newPath), {
          status: "renamed",
          oldPath: oldPath ? unescapeGitPath(oldPath) : undefined,
        });
      }
    } else if (statusCode === "A") {
      const path = parts[1];
      if (path) {
        result.set(unescapeGitPath(path), { status: "added" });
      }
    } else if (statusCode === "D") {
      const path = parts[1];
      if (path) {
        result.set(unescapeGitPath(path), { status: "deleted" });
      }
    } else if (statusCode === "M") {
      const path = parts[1];
      if (path) {
        result.set(unescapeGitPath(path), { status: "modified" });
      }
    }
  }

  return result;
}

/**
 * Parse git diff --numstat output to get per-file stats
 * Format: "<additions>\t<deletions>\t<path>"
 * Paths may be quoted if they contain special characters
 */
function parseStats(
  output: string,
): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.trim().split("\n")) {
    if (!line) continue;

    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const additions = parseInt(parts[0], 10) || 0;
    const deletions = parseInt(parts[1], 10) || 0;
    const path = parts[2];

    if (path) {
      result.set(unescapeGitPath(path), { additions, deletions });
    }
  }

  return result;
}

/**
 * Split full diff output by file
 * Each file starts with "diff --git a/... b/..."
 * Handles both quoted paths (for special chars) and unquoted paths
 */
function splitDiffByFile(fullDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  // Match both quoted and unquoted paths:
  // - "a/..." (quoted) or a/... (unquoted) for source
  // - "b/..." (quoted, capture group 1) or b/... (unquoted, capture group 2) for destination
  const filePattern =
    /^diff --git (?:"a\/.*?"|a\/\S*) (?:"b\/(.*?)"|b\/(\S+))$/gm;

  let lastIndex = 0;
  let lastPath: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = filePattern.exec(fullDiff)) !== null) {
    if (lastPath !== null) {
      result.set(lastPath, fullDiff.slice(lastIndex, match.index).trim());
    }
    // Use quoted path (group 1) if present, otherwise unquoted (group 2)
    const rawPath = match[1] ?? match[2] ?? null;
    lastPath = rawPath ? unescapeGitPath(rawPath) : null;
    lastIndex = match.index;
  }

  // Don't forget the last file
  if (lastPath !== null) {
    result.set(lastPath, fullDiff.slice(lastIndex).trim());
  }

  return result;
}

/**
 * Build a synthetic unified-diff and DiffFile entry for an untracked (new) file.
 * Returns null if the content is null (unreadable / binary).
 */
function buildUntrackedDiffFile(
  path: string,
  content: string | null,
): { file: DiffFile; lineCount: number } | null {
  if (content === null) return null;

  const trimmed = content.trimEnd();
  const lines = trimmed.length === 0 ? [] : trimmed.split("\n");
  const lineCount = lines.length;

  const diffLines = lines.map((line) => `+${line}`).join("\n");
  const syntheticDiff = `diff --git a/${path} b/${path}
new file mode 100644
--- /dev/null
+++ b/${path}
@@ -0,0 +1,${lineCount} @@
${diffLines}`;

  return {
    file: {
      path,
      status: "added",
      stagingStatus: "unstaged",
      additions: lineCount,
      deletions: 0,
      diff: syntheticDiff,
    },
    lineCount,
  };
}

/**
 * Lock / generated files whose diff content is too noisy to display.
 * We still list them (with stats) but skip fetching the actual patch.
 */
const GENERATED_FILE_PATTERNS = [
  /(?:^|\/)bun\.lockb?$/,
  /(?:^|\/)bun\.lock$/,
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)Cargo\.lock$/,
  /(?:^|\/)composer\.lock$/,
  /(?:^|\/)Gemfile\.lock$/,
  /(?:^|\/)poetry\.lock$/,
  /(?:^|\/)Pipfile\.lock$/,
  /(?:^|\/)go\.sum$/,
];

function isGeneratedFile(filePath: string): boolean {
  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/** Only allow ref names that look like valid git refs (alphanumeric, slashes, dots, dashes, underscores). */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\-/]+$/;

/**
 * Resolve the best git ref to diff against.
 *
 * 1. If the repo was cloned from a remote, use origin's default branch
 *    (detected via `git symbolic-ref refs/remotes/origin/HEAD`).
 * 2. If no remote exists (local-only sandbox), fall back to HEAD.
 * 3. If there are no commits at all, return null so callers can handle
 *    the empty-repo case.
 */
async function resolveBaseRef(
  sandbox: Pick<Sandbox, "exec">,
  cwd: string,
): Promise<string | null> {
  // Try remote default branch first
  const symRef = await sandbox.exec(
    "git symbolic-ref refs/remotes/origin/HEAD",
    cwd,
    10000,
  );
  if (symRef.success && symRef.stdout.trim()) {
    // "refs/remotes/origin/main" → "origin/main"
    const full = symRef.stdout.trim();
    const match = full.match(/^refs\/remotes\/(.+)$/);
    if (match && SAFE_REF_PATTERN.test(match[1])) {
      return match[1];
    }
  }

  // No remote — check if HEAD exists (i.e. at least one commit)
  const headCheck = await sandbox.exec("git rev-parse HEAD", cwd, 10000);
  if (headCheck.success && headCheck.stdout.trim()) {
    return "HEAD";
  }

  // No commits at all
  return null;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasRuntimeSandboxState(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    // Determine the best base ref for the diff:
    // - origin's default branch (for cloned repos)
    // - HEAD (for local repos with commits)
    // - null (for brand-new repos with no commits)
    const baseRef = await resolveBaseRef(sandbox, cwd);

    // When diffing against a remote branch (e.g. origin/main), use
    // `git merge-base` to find the common ancestor between that branch and
    // HEAD. This avoids showing unrelated changes that were merged into the
    // remote branch after the current branch was created.
    let diffRef = baseRef;
    if (baseRef && baseRef !== "HEAD") {
      const mergeBaseResult = await sandbox.exec(
        `git merge-base ${baseRef} HEAD`,
        cwd,
        10000,
      );
      if (mergeBaseResult.success && mergeBaseResult.stdout.trim()) {
        diffRef = mergeBaseResult.stdout.trim();
      }
      // If merge-base fails, fall back to the original baseRef
    }

    // Run git commands sequentially; some sandbox backends are not reliable
    // with concurrent command streams after reconnect.

    // For repos with no commits, we can only list untracked files
    if (baseRef === null) {
      const untrackedResult = await sandbox.exec(
        "git ls-files --others --exclude-standard",
        cwd,
        30000,
      );

      if (!untrackedResult.success) {
        const stderr = untrackedResult.stderr || "Unknown git error";
        if (isSandboxUnavailableError(stderr)) {
          await updateSession(sessionId, {
            sandboxState: clearSandboxState(sessionRecord.sandboxState),
            ...buildHibernatedLifecycleUpdate(),
          });
          return Response.json(
            { error: "Sandbox is unavailable. Please resume sandbox." },
            { status: 409 },
          );
        }
        console.error("Git command failed:", stderr);
        return Response.json(
          {
            error: "Git command failed. Ensure this is a git repository.",
          },
          { status: 400 },
        );
      }

      // All files are untracked in a repo with no commits
      const files: DiffFile[] = [];
      let totalAdditions = 0;

      const untrackedFiles = untrackedResult.stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);

      const untrackedFileContents = await Promise.all(
        untrackedFiles.map(async (filePath) => {
          const fullPath = `${cwd}/${filePath}`;
          try {
            const content = await sandbox.readFile(fullPath, "utf-8");
            return { path: filePath, content };
          } catch {
            return { path: filePath, content: null };
          }
        }),
      );

      for (const { path, content } of untrackedFileContents) {
        const entry = buildUntrackedDiffFile(path, content);
        if (!entry) continue;
        totalAdditions += entry.lineCount;
        files.push(entry.file);
      }

      const statusOrder = { modified: 0, added: 1, renamed: 2, deleted: 3 };
      files.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

      const response: DiffResponse = {
        files,
        baseRef: "(no commits)",
        summary: {
          totalFiles: files.length,
          totalAdditions,
          totalDeletions: 0,
        },
      };

      updateSession(sessionId, {
        cachedDiff: response,
        cachedDiffUpdatedAt: new Date(),
        linesAdded: response.summary.totalAdditions,
        linesRemoved: response.summary.totalDeletions,
      }).catch((err) => console.error("Failed to cache diff:", err));

      return Response.json(response);
    }

    // Normal path: we have a valid base ref to diff against.
    // Use diffRef (merge-base) so we only see changes introduced on
    // this branch, not changes merged into the remote default branch.
    const nameStatusResult = await sandbox.exec(
      `git diff ${diffRef} --name-status`,
      cwd,
      30000,
    );
    const numstatResult = await sandbox.exec(
      `git diff ${diffRef} --numstat`,
      cwd,
      30000,
    );
    // Parse name-status early so we can exclude generated/lock files from the
    // full diff. This avoids huge output that can truncate and lose diffs for
    // other files. We still get their stats from --name-status and --numstat.
    const fileStatuses = parseNameStatus(nameStatusResult.stdout);
    const generatedExcludes = Array.from(fileStatuses.keys())
      .filter(isGeneratedFile)
      .map((p) => `":(exclude)${p}"`)
      .join(" ");
    const diffCmd = generatedExcludes
      ? `git diff ${diffRef} -- . ${generatedExcludes}`
      : `git diff ${diffRef}`;
    const diffResult = await sandbox.exec(diffCmd, cwd, 60000);
    const untrackedResult = await sandbox.exec(
      "git ls-files --others --exclude-standard",
      cwd,
      30000,
    );
    // Get staged file paths to determine staging status
    const stagedResult = await sandbox.exec(
      "git diff --cached --name-only",
      cwd,
      30000,
    );

    // Check if git commands failed (e.g., not a git repo or ref doesn't exist)
    if (!nameStatusResult.success || !diffResult.success) {
      const stderr =
        nameStatusResult.stderr || diffResult.stderr || "Unknown git error";
      if (isSandboxUnavailableError(stderr)) {
        await updateSession(sessionId, {
          sandboxState: clearSandboxState(sessionRecord.sandboxState),
          ...buildHibernatedLifecycleUpdate(),
        });
        return Response.json(
          { error: "Sandbox is unavailable. Please resume sandbox." },
          { status: 409 },
        );
      }
      console.error("Git command failed:", stderr);
      return Response.json(
        {
          error:
            "Git command failed. Ensure this is a git repository with at least one commit.",
        },
        { status: 400 },
      );
    }

    if (!numstatResult.success || !untrackedResult.success) {
      const stderr =
        numstatResult.stderr || untrackedResult.stderr || "Unknown git error";
      if (isSandboxUnavailableError(stderr)) {
        await updateSession(sessionId, {
          sandboxState: clearSandboxState(sessionRecord.sandboxState),
          ...buildHibernatedLifecycleUpdate(),
        });
        return Response.json(
          { error: "Sandbox is unavailable. Please resume sandbox." },
          { status: 409 },
        );
      }
    }

    // Build set of staged file paths
    const stagedFiles = new Set<string>();
    if (stagedResult.success && stagedResult.stdout.trim()) {
      for (const line of stagedResult.stdout.trim().split("\n")) {
        if (line) stagedFiles.add(unescapeGitPath(line));
      }
    }

    // Build set of unstaged (working tree) changed file paths.
    // We compare the working tree against the index to find files with
    // unstaged modifications. Combined with the staged set, this lets us
    // determine partial staging.
    const unstagedFiles = new Set<string>();
    const unstagedResult = await sandbox.exec(
      "git diff --name-only",
      cwd,
      30000,
    );
    if (unstagedResult.success && unstagedResult.stdout.trim()) {
      for (const line of unstagedResult.stdout.trim().split("\n")) {
        if (line) unstagedFiles.add(unescapeGitPath(line));
      }
    }

    // Parse remaining outputs (fileStatuses already parsed above)
    const fileStats = parseStats(numstatResult.stdout);
    const fileDiffs = splitDiffByFile(diffResult.stdout);

    // Build response
    const files: DiffFile[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    // Determine staging status for a file.
    // When diffing against a remote base (e.g. origin/main), a file might
    // appear in the full diff because of committed, staged, or unstaged
    // changes. We use the index-level info to classify:
    function getStagingStatus(filePath: string): DiffFile["stagingStatus"] {
      const isStaged = stagedFiles.has(filePath);
      const isUnstaged = unstagedFiles.has(filePath);
      if (isStaged && isUnstaged) return "partial";
      if (isStaged) return "staged";
      // Files that are in neither set are already committed on the branch
      // (relative to HEAD, they have no pending changes). Treat them as
      // staged since they're part of committed work.
      if (!isStaged && !isUnstaged) return "staged";
      return "unstaged";
    }

    // Collect files whose diffs are missing from the bulk output (e.g. due
    // to output truncation when the full diff is very large).
    // Skip generated/lock files — we intentionally omit their diff content.
    const missingDiffPaths: string[] = [];
    for (const [path] of fileStatuses) {
      if (!fileDiffs.has(path) && !isGeneratedFile(path)) {
        missingDiffPaths.push(path);
      }
    }

    // Fetch individual diffs for any missing files sequentially; some
    // sandbox backends are not reliable with concurrent exec streams.
    for (const filePath of missingDiffPaths) {
      const result = await sandbox.exec(
        `git diff ${diffRef} -- ${JSON.stringify(filePath)}`,
        cwd,
        30000,
      );
      const diff = result.success ? result.stdout.trim() : "";
      if (diff) {
        fileDiffs.set(filePath, diff);
      }
    }

    // Add tracked file changes
    for (const [path, statusInfo] of fileStatuses) {
      const stats = fileStats.get(path) ?? { additions: 0, deletions: 0 };
      const generated = isGeneratedFile(path);
      const diff = generated ? "" : (fileDiffs.get(path) ?? "");

      totalAdditions += stats.additions;
      totalDeletions += stats.deletions;

      files.push({
        path,
        status: statusInfo.status,
        stagingStatus: getStagingStatus(path),
        additions: stats.additions,
        deletions: stats.deletions,
        diff,
        ...(generated && { generated: true }),
        ...(statusInfo.oldPath && { oldPath: statusInfo.oldPath }),
      });
    }

    // Add untracked files (new files)
    const untrackedFiles = untrackedResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

    // Fetch content for untracked files to generate diff
    const untrackedFileContents = await Promise.all(
      untrackedFiles.map(async (filePath) => {
        const fullPath = `${cwd}/${filePath}`;
        try {
          const content = await sandbox.readFile(fullPath, "utf-8");
          return { path: filePath, content };
        } catch {
          // Skip files we can't read (binary, permissions, etc.)
          return { path: filePath, content: null };
        }
      }),
    );

    for (const { path, content } of untrackedFileContents) {
      const entry = buildUntrackedDiffFile(path, content);
      if (!entry) continue;
      totalAdditions += entry.lineCount;
      files.push(entry.file);
    }

    // Sort files: modified first, then added, then renamed, then deleted
    const statusOrder = { modified: 0, added: 1, renamed: 2, deleted: 3 };
    files.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const response: DiffResponse = {
      files,
      baseRef,
      summary: {
        totalFiles: files.length,
        totalAdditions,
        totalDeletions,
      },
    };

    // Cache diff for offline viewing (fire-and-forget)
    updateSession(sessionId, {
      cachedDiff: response,
      cachedDiffUpdatedAt: new Date(),
      linesAdded: response.summary.totalAdditions,
      linesRemoved: response.summary.totalDeletions,
    }).catch((err) => console.error("Failed to cache diff:", err));

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearSandboxState(sessionRecord.sandboxState),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        { error: "Sandbox is unavailable. Please resume sandbox." },
        { status: 409 },
      );
    }
    console.error("Failed to get diff:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
