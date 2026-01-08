import {
  type Sandbox,
  createLocalSandbox,
  connectVercelSandbox,
  createJustBashSandbox,
} from "../agent/sandbox/index.js";

export type SandboxType = "local" | "vercel" | "just-bash";

export interface SandboxFactoryOptions {
  type: SandboxType;
  workingDirectory: string;
  /** GitHub repo to clone (e.g., "vercel/ai" or full URL) */
  repo?: string;
}

/**
 * Create a sandbox based on the specified type.
 *
 * For local sandbox:
 * - Uses the current working directory
 *
 * For Vercel sandbox:
 * - Optionally clones a repo via --repo flag or SANDBOX_REPO_URL env var
 * - Repo can be shorthand (e.g., "vercel/ai") or full URL
 * - Additional config from environment variables:
 *   - GITHUB_TOKEN: GitHub PAT for private repos (optional)
 *   - SANDBOX_BRANCH: Branch to clone (optional, defaults to main)
 *   - SANDBOX_NEW_BRANCH: New branch to create for agent work (optional)
 */
export async function createSandbox(
  options: SandboxFactoryOptions,
): Promise<Sandbox> {
  const { type, workingDirectory, repo } = options;

  switch (type) {
    case "local":
      return createLocalSandbox(workingDirectory);

    case "vercel": {
      const repoInput = repo ?? process.env.SANDBOX_REPO_URL;
      const repoUrl = repoInput ? expandRepoUrl(repoInput) : undefined;

      const token = process.env.GITHUB_TOKEN;
      const branch = process.env.SANDBOX_BRANCH;
      const newBranch = process.env.SANDBOX_NEW_BRANCH;

      return connectVercelSandbox({
        ...(repoUrl && {
          gitUser: {
            name: "Open Harness",
            email: "open.harness@vercel.com",
          },
          source: {
            url: repoUrl,
            ...(token && { token }),
            ...(branch && { branch }),
            ...(newBranch && { newBranch }),
          },
        }),
        ...(token && { env: { GITHUB_TOKEN: token } }),
      });
    }

    case "just-bash": {
      return createJustBashSandbox({
        workingDirectory,
        mode: "overlay",
      });
    }

    default:
      throw new Error(`Unknown sandbox type: ${type}`);
  }
}

/**
 * Expand a repo shorthand (e.g., "vercel/ai") to a full GitHub URL.
 * If already a full URL, return as-is.
 */
function expandRepoUrl(repo: string): string {
  if (repo.startsWith("http://") || repo.startsWith("https://")) {
    return repo;
  }
  return `https://github.com/${repo}`;
}

/**
 * Parse sandbox type from CLI argument value.
 */
export function parseSandboxType(value: string): SandboxType {
  const normalized = value.toLowerCase();
  if (
    normalized === "local" ||
    normalized === "vercel" ||
    normalized === "just-bash"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid sandbox type: ${value}. Valid options: local, vercel, just-bash`,
  );
}
