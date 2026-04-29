import type { FileChangeStatus, Sandbox } from "@open-agents/sandbox";
import {
  detectBinaryFiles,
  getChangedFiles,
  getFileModes,
  getHeadSha,
} from "@open-agents/sandbox";
import type { GitIdentity } from "./commit";

const MAX_COMMIT_FILES = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type GitTreeFileMode = "100644" | "100755";
export type CommitFileEncoding = "utf-8" | "base64";

export interface CommitIntentFile {
  path: string;
  status: FileChangeStatus;
  oldPath?: string;
  content: string;
  encoding: CommitFileEncoding;
  mode: GitTreeFileMode;
  byteSize: number;
}

export interface CommitIntent {
  owner: string;
  repo: string;
  repositoryId: number;
  installationId: number;
  branch: string;
  baseBranch?: string;
  expectedHeadSha: string;
  message: string;
  files: CommitIntentFile[];
  coAuthor?: GitIdentity;
}

export type BuildCommitIntentResult =
  | { ok: true; intent: CommitIntent }
  | { ok: false; error: string; empty?: boolean };

function isValidGitTreeFileMode(value: string): value is GitTreeFileMode {
  return value === "100644" || value === "100755";
}

export function getRepoRelativePathError(path: string): string | null {
  if (!path) {
    return "Path is empty";
  }
  if (path.startsWith("/") || path.includes("\0")) {
    return "Path must be repo-relative";
  }

  for (const segment of path.split("/")) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment === ".git"
    ) {
      return "Path contains an unsupported segment";
    }
  }

  return null;
}

async function readCommitFile(params: {
  sandbox: Sandbox;
  cwd: string;
  path: string;
  isBinary: boolean;
}): Promise<{
  content: string;
  encoding: CommitFileEncoding;
  byteSize: number;
}> {
  const fullPath = `${params.cwd}/${params.path}`;

  if (params.isBinary) {
    const buffer = await params.sandbox.readFileBuffer(fullPath);
    return {
      content: buffer.toString("base64"),
      encoding: "base64",
      byteSize: buffer.byteLength,
    };
  }

  const content = await params.sandbox.readFile(fullPath, "utf-8");
  return {
    content,
    encoding: "utf-8",
    byteSize: Buffer.byteLength(content, "utf-8"),
  };
}

export async function buildCommitIntentFromSandbox(params: {
  sandbox: Sandbox;
  owner: string;
  repo: string;
  repositoryId: number;
  installationId: number;
  branch: string;
  baseBranch?: string;
  message: string;
  coAuthor?: GitIdentity;
}): Promise<BuildCommitIntentResult> {
  const changes = await getChangedFiles(params.sandbox);
  if (changes.length === 0) {
    return { ok: false, empty: true, error: "No changes to commit" };
  }
  if (changes.length > MAX_COMMIT_FILES) {
    return {
      ok: false,
      error: `Too many changed files (${changes.length}; max ${MAX_COMMIT_FILES})`,
    };
  }

  const [binaryFiles, fileModes, expectedHeadSha] = await Promise.all([
    detectBinaryFiles(params.sandbox),
    getFileModes(params.sandbox),
    getHeadSha(params.sandbox),
  ]);

  const files: CommitIntentFile[] = [];
  let totalBytes = 0;

  for (const change of changes) {
    const pathError = getRepoRelativePathError(change.path);
    if (pathError) {
      return {
        ok: false,
        error: `Invalid path '${change.path}': ${pathError}`,
      };
    }

    if (change.oldPath) {
      const oldPathError = getRepoRelativePathError(change.oldPath);
      if (oldPathError) {
        return {
          ok: false,
          error: `Invalid old path '${change.oldPath}': ${oldPathError}`,
        };
      }
    }

    const rawMode = fileModes.get(change.path) ?? "100644";
    if (!isValidGitTreeFileMode(rawMode)) {
      return {
        ok: false,
        error: `Unsupported git file mode '${rawMode}' for '${change.path}'`,
      };
    }

    if (change.status === "deleted") {
      files.push({
        path: change.path,
        status: change.status,
        ...(change.oldPath ? { oldPath: change.oldPath } : {}),
        content: "",
        encoding: "utf-8",
        mode: rawMode,
        byteSize: 0,
      });
      continue;
    }

    const file = await readCommitFile({
      sandbox: params.sandbox,
      cwd: params.sandbox.workingDirectory,
      path: change.path,
      isBinary: binaryFiles.has(change.path),
    });

    if (file.byteSize > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `File '${change.path}' is too large to commit`,
      };
    }

    totalBytes += file.byteSize;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return { ok: false, error: "Commit bundle is too large" };
    }

    files.push({
      path: change.path,
      status: change.status,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      content: file.content,
      encoding: file.encoding,
      mode: rawMode,
      byteSize: file.byteSize,
    });
  }

  return {
    ok: true,
    intent: {
      owner: params.owner,
      repo: params.repo,
      repositoryId: params.repositoryId,
      installationId: params.installationId,
      branch: params.branch,
      ...(params.baseBranch ? { baseBranch: params.baseBranch } : {}),
      expectedHeadSha,
      message: params.message,
      files,
      ...(params.coAuthor ? { coAuthor: params.coAuthor } : {}),
    },
  };
}
