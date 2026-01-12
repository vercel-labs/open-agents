import { Octokit } from "@octokit/rest";
import { getUserGitHubToken } from "./user-token";

type OctokitResult =
  | { octokit: Octokit; authenticated: true }
  | { octokit: null; authenticated: false };

export async function getOctokit(): Promise<OctokitResult> {
  const userToken = await getUserGitHubToken();

  if (!userToken) {
    console.warn("No GitHub token - user needs to connect GitHub");
    return { octokit: null, authenticated: false };
  }

  return {
    octokit: new Octokit({ auth: userToken }),
    authenticated: true,
  };
}

export function parseGitHubUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com[/:]([.\w-]+)\/([.\w-]+?)(\.git)?$/);
  if (match && match[1] && match[2]) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

export async function createPullRequest(params: {
  repoUrl: string;
  branchName: string;
  title: string;
  body?: string;
  baseBranch?: string;
}): Promise<{
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}> {
  const { repoUrl, branchName, title, body = "", baseBranch = "main" } = params;

  try {
    const result = await getOctokit();

    if (!result.authenticated) {
      return { success: false, error: "GitHub account not connected" };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return { success: false, error: "Invalid GitHub repository URL" };
    }

    const { owner, repo } = parsed;

    const response = await result.octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branchName,
      base: baseBranch,
    });

    return {
      success: true,
      prUrl: response.data.html_url,
      prNumber: response.data.number,
    };
  } catch (error: unknown) {
    console.error("Error creating PR:", error);

    const httpError = error as { status?: number };
    if (httpError.status === 422) {
      return { success: false, error: "PR already exists or branch not found" };
    }
    if (httpError.status === 403) {
      return { success: false, error: "Permission denied" };
    }
    if (httpError.status === 404) {
      return { success: false, error: "Repository not found or no access" };
    }

    return { success: false, error: "Failed to create pull request" };
  }
}

export async function mergePullRequest(params: {
  repoUrl: string;
  prNumber: number;
  mergeMethod?: "merge" | "squash" | "rebase";
}): Promise<{ success: boolean; sha?: string; error?: string }> {
  const { repoUrl, prNumber, mergeMethod = "squash" } = params;

  try {
    const result = await getOctokit();

    if (!result.authenticated) {
      return { success: false, error: "GitHub account not connected" };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return { success: false, error: "Invalid GitHub repository URL" };
    }

    const { owner, repo } = parsed;

    const response = await result.octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
    });

    return {
      success: true,
      sha: response.data.sha,
    };
  } catch (error: unknown) {
    console.error("Error merging PR:", error);

    const httpError = error as { status?: number };
    if (httpError.status === 405) {
      return { success: false, error: "PR is not mergeable" };
    }
    if (httpError.status === 409) {
      return { success: false, error: "Merge conflict" };
    }

    return { success: false, error: "Failed to merge pull request" };
  }
}

export async function getPullRequestStatus(params: {
  repoUrl: string;
  prNumber: number;
}): Promise<{
  success: boolean;
  status?: "open" | "closed" | "merged";
  error?: string;
}> {
  const { repoUrl, prNumber } = params;

  try {
    const result = await getOctokit();

    if (!result.authenticated) {
      return { success: false, error: "GitHub account not connected" };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return { success: false, error: "Invalid GitHub repository URL" };
    }

    const { owner, repo } = parsed;

    const response = await result.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    let status: "open" | "closed" | "merged";
    if (response.data.merged_at) {
      status = "merged";
    } else if (response.data.state === "closed") {
      status = "closed";
    } else {
      status = "open";
    }

    return { success: true, status };
  } catch {
    return { success: false, error: "Failed to get PR status" };
  }
}
