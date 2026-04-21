import type { Sandbox } from "@open-agents/sandbox";
import {
  buildUntrackedDiffFile,
  isGeneratedFile,
  parseNameStatus,
  parseStats,
  resolveBaseRef,
  splitDiffByFile,
  unescapeGitPath,
} from "@/app/api/sessions/[sessionId]/diff/_lib/diff-utils";
import { updateSession } from "@/lib/db/sessions";
import { isSandboxUnavailableError } from "@/lib/sandbox/utils";

export type DiffFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** May be absent in cached diffs created before this field was introduced. */
  stagingStatus?: "staged" | "unstaged" | "partial";
  additions: number;
  deletions: number;
  diff: string;
  /** Diff of only uncommitted (local) changes vs HEAD. Present when the file has local modifications. */
  localDiff?: string;
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

export class DiffComputationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiffComputationError";
  }
}

export async function computeAndCacheDiff(params: {
  sandbox: Sandbox;
  sessionId: string;
}): Promise<DiffResponse> {
  const { sandbox, sessionId } = params;
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
        throw new Error(stderr);
      }
      console.error("Git command failed:", stderr);
      throw new DiffComputationError(
        "Git command failed. Ensure this is a git repository.",
        400,
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

    return response;
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
      throw new Error(stderr);
    }
    console.error("Git command failed:", stderr);
    throw new DiffComputationError(
      "Git command failed. Ensure this is a git repository with at least one commit.",
      400,
    );
  }

  if (!numstatResult.success || !untrackedResult.success) {
    const stderr =
      numstatResult.stderr || untrackedResult.stderr || "Unknown git error";
    if (isSandboxUnavailableError(stderr)) {
      throw new Error(stderr);
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
  const unstagedResult = await sandbox.exec("git diff --name-only", cwd, 30000);
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

  // Fetch local-only diffs (uncommitted changes vs HEAD) for files with
  // local modifications. This runs `git diff HEAD -- <file>` sequentially
  // for each file that has unstaged or partially staged changes.
  for (const file of files) {
    if (
      !file.generated &&
      (file.stagingStatus === "unstaged" || file.stagingStatus === "partial")
    ) {
      const localResult = await sandbox.exec(
        `git diff HEAD -- ${JSON.stringify(file.path)}`,
        cwd,
        30000,
      );
      if (localResult.success && localResult.stdout.trim()) {
        file.localDiff = localResult.stdout.trim();
      }
    }
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

  return response;
}
