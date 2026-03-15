import type { Sandbox } from "@open-harness/sandbox";

export type DiffFileShape = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  stagingStatus?: "staged" | "unstaged" | "partial";
  additions: number;
  deletions: number;
  diff: string;
  oldPath?: string;
  generated?: boolean;
};

/**
 * Unescape C-style escape sequences in git quoted paths
 * Git uses C-style quoting for special chars: \n, \t, \\, \", etc.
 * Handles both fully quoted paths ("path") and already-unquoted escaped content
 */
export function unescapeGitPath(path: string): string {
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
export function parseNameStatus(
  output: string,
): Map<string, { status: DiffFileShape["status"]; oldPath?: string }> {
  const result = new Map<
    string,
    { status: DiffFileShape["status"]; oldPath?: string }
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
export function parseStats(
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
export function splitDiffByFile(fullDiff: string): Map<string, string> {
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
export function buildUntrackedDiffFile(
  path: string,
  content: string | null,
): { file: DiffFileShape; lineCount: number } | null {
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

export function isGeneratedFile(filePath: string): boolean {
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
export async function resolveBaseRef(
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
