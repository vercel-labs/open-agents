import type { NextRequest } from "next/server";
import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type DiffFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff: string;
  oldPath?: string;
};

export type DiffResponse = {
  files: DiffFile[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
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
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sessionRecord.sandboxState);
    const cwd = sandbox.workingDirectory;

    // Run git commands in parallel
    const [nameStatusResult, numstatResult, diffResult, untrackedResult] =
      await Promise.all([
        sandbox.exec("git diff HEAD --name-status", cwd, 30000),
        sandbox.exec("git diff HEAD --numstat", cwd, 30000),
        sandbox.exec("git diff HEAD", cwd, 60000),
        // Get untracked files (new files not yet staged)
        sandbox.exec("git ls-files --others --exclude-standard", cwd, 30000),
      ]);

    // Check if git commands failed (e.g., not a git repo or HEAD doesn't exist)
    if (!nameStatusResult.success || !diffResult.success) {
      const stderr =
        nameStatusResult.stderr || diffResult.stderr || "Unknown git error";
      console.error("Git command failed:", stderr);
      return Response.json(
        {
          error:
            "Git command failed. Ensure this is a git repository with at least one commit.",
        },
        { status: 400 },
      );
    }

    // Parse outputs
    const fileStatuses = parseNameStatus(nameStatusResult.stdout);
    const fileStats = parseStats(numstatResult.stdout);
    const fileDiffs = splitDiffByFile(diffResult.stdout);

    // Build response
    const files: DiffFile[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    // Add tracked file changes
    for (const [path, statusInfo] of fileStatuses) {
      const stats = fileStats.get(path) ?? { additions: 0, deletions: 0 };
      const diff = fileDiffs.get(path) ?? "";

      totalAdditions += stats.additions;
      totalDeletions += stats.deletions;

      files.push({
        path,
        status: statusInfo.status,
        additions: stats.additions,
        deletions: stats.deletions,
        diff,
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
      // Skip binary files or files we couldn't read
      if (content === null) continue;

      // Remove trailing newlines before splitting to get accurate line count
      const trimmed = content.trimEnd();
      const lines = trimmed.length === 0 ? [] : trimmed.split("\n");
      const lineCount = lines.length;

      // Generate a synthetic diff for the new file
      const diffLines = lines.map((line) => `+${line}`).join("\n");
      const syntheticDiff = `diff --git a/${path} b/${path}
new file mode 100644
--- /dev/null
+++ b/${path}
@@ -0,0 +1,${lineCount} @@
${diffLines}`;

      totalAdditions += lineCount;

      files.push({
        path,
        status: "added",
        additions: lineCount,
        deletions: 0,
        diff: syntheticDiff,
      });
    }

    // Sort files: modified first, then added, then renamed, then deleted
    const statusOrder = { modified: 0, added: 1, renamed: 2, deleted: 3 };
    files.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const response: DiffResponse = {
      files,
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
    console.error("Failed to get diff:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
