import { Octokit } from "@octokit/rest";

export type { Octokit } from "@octokit/rest";

type OctokitResult =
  | { octokit: Octokit; authenticated: true }
  | { octokit: null; authenticated: false };

/**
 * Create an Octokit instance from a raw token.
 * Prefer getUserOctokit(userId) when you have a userId.
 */
export async function getOctokit(token?: string): Promise<OctokitResult> {
  if (!token) {
    console.warn("No GitHub token - user needs to connect GitHub");
    return { octokit: null, authenticated: false };
  }

  return {
    octokit: new Octokit({ auth: token }),
    authenticated: true,
  };
}

/**
 * Create an Octokit instance for the given user.
 * Fetches the user's OAuth token internally via token.ts.
 */
export async function getUserOctokit(userId: string): Promise<Octokit | null> {
  // dynamic import to avoid pulling in "server-only" at module load
  const { getUserGitHubToken } = await import("./token");
  const token = await getUserGitHubToken(userId);
  if (!token) return null;
  return new Octokit({ auth: token });
}

/**
 * Parse a GitHub URL into owner/repo.
 * Supports https://github.com/owner/repo and git@github.com:owner/repo.git
 */
export function parseGitHubUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com[/:]([.\w-]+)\/([.\w-]+?)(\.git)?$/);
  if (match && match[1] && match[2]) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}
