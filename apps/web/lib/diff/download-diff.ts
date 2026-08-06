import type { Sandbox } from "@open-agents/sandbox";
import {
  buildUntrackedDiffFile,
  resolveBaseRef,
} from "@/app/api/sessions/[sessionId]/diff/_lib/diff-utils";
import { isSandboxUnavailableError } from "@/lib/sandbox/utils";

export type DownloadDiffResult = {
  content: string;
  filename: string;
};

export class DownloadDiffError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DownloadDiffError";
  }
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || "changes";
}

async function resolveFullDiffRef(
  sandbox: Sandbox,
  cwd: string,
): Promise<string | null> {
  const baseRef = await resolveBaseRef(sandbox, cwd);
  if (!baseRef || baseRef === "HEAD") return baseRef;

  // Match the Changes tab behavior: compare against the branch point, not
  // against commits that landed on the remote default branch later.
  const mergeBaseResult = await sandbox.exec(
    `git merge-base ${baseRef} HEAD`,
    cwd,
    10000,
  );
  if (mergeBaseResult.success && mergeBaseResult.stdout.trim()) {
    return mergeBaseResult.stdout.trim();
  }

  return baseRef;
}

async function getPatchFilename(sandbox: Sandbox, cwd: string) {
  const branchResult = await sandbox.exec(
    "git branch --show-current",
    cwd,
    10000,
  );
  if (branchResult.success && branchResult.stdout.trim()) {
    return `${sanitizeFilename(branchResult.stdout.trim())}.diff`;
  }

  const headResult = await sandbox.exec(
    "git rev-parse --short HEAD",
    cwd,
    10000,
  );
  if (headResult.success && headResult.stdout.trim()) {
    return `${sanitizeFilename(headResult.stdout.trim())}.diff`;
  }

  return "changes.diff";
}

async function getTrackedDiff(params: {
  sandbox: Sandbox;
  cwd: string;
  diffRef: string | null;
}): Promise<string> {
  const { sandbox, cwd, diffRef } = params;
  if (!diffRef) return "";

  const result = await sandbox.exec(`git diff ${diffRef}`, cwd, 60000);
  if (!result.success) {
    const stderr = result.stderr || "Failed to create diff";
    if (isSandboxUnavailableError(stderr)) {
      throw new Error(stderr);
    }
    throw new DownloadDiffError(stderr, 400);
  }

  return result.stdout.trim();
}

async function getUntrackedDiff(
  sandbox: Sandbox,
  cwd: string,
): Promise<string> {
  const result = await sandbox.exec(
    "git ls-files --others --exclude-standard",
    cwd,
    30000,
  );
  if (!result.success) {
    const stderr = result.stderr || "Failed to inspect untracked files";
    if (isSandboxUnavailableError(stderr)) {
      throw new Error(stderr);
    }
    throw new DownloadDiffError(stderr, 400);
  }

  const untrackedFiles = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);

  const diffs: string[] = [];
  for (const filePath of untrackedFiles) {
    try {
      const content = await sandbox.readFile(`${cwd}/${filePath}`, "utf-8");
      const entry = buildUntrackedDiffFile(filePath, content);
      if (entry?.file.diff) {
        diffs.push(entry.file.diff);
      }
    } catch {
      // Unreadable or binary untracked files cannot be represented as a text
      // patch.
    }
  }

  return diffs.join("\n\n");
}

export async function createDownloadDiff(
  sandbox: Sandbox,
): Promise<DownloadDiffResult> {
  const cwd = sandbox.workingDirectory;
  const diffRef = await resolveFullDiffRef(sandbox, cwd);
  const trackedDiff = await getTrackedDiff({ sandbox, cwd, diffRef });
  const untrackedDiff = await getUntrackedDiff(sandbox, cwd);
  const content = [trackedDiff, untrackedDiff].filter(Boolean).join("\n\n");

  if (!content.trim()) {
    throw new DownloadDiffError("No changes available to download.", 404);
  }

  return {
    content: `${content}\n`,
    filename: await getPatchFilename(sandbox, cwd),
  };
}
