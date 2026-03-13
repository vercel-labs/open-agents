/**
 * GitHub Tarball Download and Extraction Utilities
 *
 * Downloads and extracts GitHub repository tarballs into a file map.
 *
 * This utility is provider-agnostic and can be used to prepare repository content
 * for sandbox bootstrapping flows.
 */

import { gunzipSync } from "zlib";

const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

// Lock files to skip - they're large and not useful for agent exploration
const LOCK_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
]);

function isLockFile(fileName: string): boolean {
  return LOCK_FILES.has(fileName);
}

export interface TarballResult {
  files: Record<string, string>;
  fileCount: number;
  totalBytes: number;
  downloadMs: number;
  extractMs: number;
}

interface RepoInfo {
  owner: string;
  repo: string;
}

/**
 * Parse a GitHub URL to extract owner and repo name.
 *
 * @example
 * parseGitHubUrl("https://github.com/vercel/ai")
 * // => { owner: "vercel", repo: "ai" }
 */
export function parseGitHubUrl(url: string): RepoInfo {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

function buildTarballUrl(owner: string, repo: string, ref: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
}

/**
 * Download and extract a GitHub repository tarball into a files map.
 *
 * @param repoUrl - GitHub repository URL (e.g., "https://github.com/owner/repo")
 * @param branch - Branch name (defaults to "main")
 * @param token - GitHub token for authentication (optional, helps with rate limits)
 * @param workingDirectory - Base path for extracted files (defaults to "/vercel/sandbox")
 * @returns TarballResult with files map and metadata
 */
export async function downloadAndExtractTarball(
  repoUrl: string,
  branch: string = "main",
  token?: string,
  workingDirectory: string = DEFAULT_WORKING_DIRECTORY,
): Promise<TarballResult> {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const tarballUrl = buildTarballUrl(owner, repo, branch);

  const downloadStart = performance.now();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "open-harness",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(tarballUrl, { headers });

  if (!response.ok) {
    throw new Error(
      `Failed to download tarball: ${response.status} ${response.statusText}`,
    );
  }

  const downloadMs = performance.now() - downloadStart;

  // Extract tarball
  const extractStart = performance.now();

  const files: Record<string, string> = {};
  let rootDir = "";

  // Download and decompress
  const arrayBuffer = await response.arrayBuffer();
  const gzipped = Buffer.from(arrayBuffer);
  const tarData = gunzipSync(gzipped);

  // Simple tar parser (USTAR format)
  // Tar files consist of 512-byte blocks
  let offset = 0;
  while (offset < tarData.length) {
    // Read header (512 bytes)
    const header = tarData.subarray(offset, offset + 512);

    // Check for end of archive (two zero blocks)
    if (header.every((b) => b === 0)) {
      break;
    }

    // Parse header fields
    const name =
      header.subarray(0, 100).toString("utf-8").split("\x00")[0] ?? "";
    const sizeOctal = header.subarray(124, 136).toString("utf-8").trim();
    const typeFlag = String.fromCharCode(header[156]!);

    // Parse size (octal string)
    const size = parseInt(sizeOctal, 8) || 0;

    // Move past header
    offset += 512;

    // Extract root directory from first entry
    if (!rootDir && name.includes("/")) {
      rootDir = name.split("/")[0]!;
    }

    // Only process regular files (typeFlag '0' or empty)
    if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      // Remove root directory prefix
      const relativePath = name.replace(`${rootDir}/`, "");

      if (relativePath && size > 0) {
        // Skip lock files - they're large and not useful for agent exploration
        const fileName = relativePath.split("/").pop() ?? "";
        if (isLockFile(fileName)) {
          offset += Math.ceil(size / 512) * 512;
          continue;
        }

        // Read file content as buffer first
        const contentBuffer = tarData.subarray(offset, offset + size);

        // Skip binary files (files containing null bytes)
        // Binary files can't be stored in PostgreSQL JSONB
        if (!contentBuffer.includes(0)) {
          const content = contentBuffer.toString("utf-8");
          files[`${workingDirectory}/${relativePath}`] = content;
        }
        // Binary files are silently skipped - agents work with text files anyway
      }
    }

    // Move to next entry (content is padded to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }

  const extractMs = performance.now() - extractStart;
  const fileCount = Object.keys(files).length;
  const totalBytes = Object.values(files).reduce(
    (acc, content) => acc + content.length,
    0,
  );

  return {
    files,
    fileCount,
    totalBytes,
    downloadMs,
    extractMs,
  };
}
