import { Octokit } from "@octokit/rest";
import { getUserGitHubToken } from "./user-token";

type OctokitResult =
  | { octokit: Octokit; authenticated: true }
  | { octokit: null; authenticated: false };

export async function getOctokit(token?: string): Promise<OctokitResult> {
  const resolvedToken = token ?? (await getUserGitHubToken());

  if (!resolvedToken) {
    console.warn("No GitHub token - user needs to connect GitHub");
    return { octokit: null, authenticated: false };
  }

  return {
    octokit: new Octokit({ auth: resolvedToken }),
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
  headRef?: string;
  title: string;
  body?: string;
  baseBranch?: string;
  token?: string;
}): Promise<{
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}> {
  const {
    repoUrl,
    branchName,
    headRef,
    title,
    body = "",
    baseBranch = "main",
    token,
  } = params;

  try {
    const result = await getOctokit(token);

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
      head: headRef ?? branchName,
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
  token?: string;
}): Promise<{ success: boolean; sha?: string; error?: string }> {
  const { repoUrl, prNumber, mergeMethod = "squash", token } = params;

  try {
    const result = await getOctokit(token);

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
  token?: string;
}): Promise<{
  success: boolean;
  status?: "open" | "closed" | "merged";
  error?: string;
}> {
  const { repoUrl, prNumber, token } = params;

  try {
    const result = await getOctokit(token);

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

/**
 * Find an open pull request for a given branch name.
 * Returns the first open PR whose head ref matches `branchName`.
 */
export async function findPullRequestByBranch(params: {
  owner: string;
  repo: string;
  branchName: string;
  token?: string;
}): Promise<{
  found: boolean;
  prNumber?: number;
  prStatus?: "open" | "closed" | "merged";
  prUrl?: string;
  prTitle?: string;
  error?: string;
}> {
  const { owner, repo, branchName, token } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return { found: false, error: "GitHub account not connected" };
    }

    // Search for PRs with this head branch (any state)
    const response = await result.octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branchName}`,
      state: "all",
      per_page: 1,
      sort: "updated",
      direction: "desc",
    });

    const pr = response.data[0];
    if (!pr) {
      return { found: false };
    }

    let prStatus: "open" | "closed" | "merged";
    if (pr.merged_at) {
      prStatus = "merged";
    } else if (pr.state === "closed") {
      prStatus = "closed";
    } else {
      prStatus = "open";
    }

    return {
      found: true,
      prNumber: pr.number,
      prStatus,
      prUrl: pr.html_url,
      prTitle: pr.title,
    };
  } catch {
    return { found: false, error: "Failed to search pull requests" };
  }
}

export async function createRepository(params: {
  name: string;
  description?: string;
  isPrivate?: boolean;
  token?: string;
  /** The account login to create the repo under (org name or username) */
  owner?: string;
  /** Whether the target owner is a User or Organization */
  accountType?: "User" | "Organization";
}): Promise<{
  success: boolean;
  repoUrl?: string;
  cloneUrl?: string;
  owner?: string;
  repoName?: string;
  error?: string;
}> {
  const {
    name,
    description = "",
    isPrivate = false,
    token,
    owner,
    accountType,
  } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return { success: false, error: "GitHub account not connected" };
    }

    // Validate repo name
    if (!/^[\w.-]+$/.test(name)) {
      return {
        success: false,
        error:
          "Invalid repository name. Use only letters, numbers, hyphens, underscores, and periods.",
      };
    }

    let response;
    if (accountType === "Organization" && owner) {
      response = await result.octokit.rest.repos.createInOrg({
        org: owner,
        name,
        description,
        private: isPrivate,
        auto_init: false,
      });
    } else {
      response = await result.octokit.rest.repos.createForAuthenticatedUser({
        name,
        description,
        private: isPrivate,
        auto_init: false,
      });
    }

    return {
      success: true,
      repoUrl: response.data.html_url,
      cloneUrl: response.data.clone_url,
      owner: response.data.owner.login,
      repoName: response.data.name,
    };
  } catch (error: unknown) {
    console.error("Error creating repository:", error);

    const httpError = error as { status?: number };
    if (httpError.status === 422) {
      return {
        success: false,
        error: "Repository name already exists or is invalid",
      };
    }
    if (httpError.status === 403) {
      return { success: false, error: "Permission denied" };
    }

    return { success: false, error: "Failed to create repository" };
  }
}
