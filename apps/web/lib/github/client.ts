import { Octokit } from "@octokit/rest";
import { getUserGitHubToken } from "./user-token";

type OctokitResult =
  | { octokit: Octokit; authenticated: true }
  | { octokit: null; authenticated: false };

export type PullRequestMergeMethod = "merge" | "squash" | "rebase";

export type PullRequestCheckState = "passed" | "pending" | "failed";

type PullRequestCheckSummary = {
  requiredTotal: number;
  passed: number;
  pending: number;
  failed: number;
};

export type PullRequestCheckRun = {
  name: string;
  state: PullRequestCheckState;
  status: string | null;
  conclusion: string | null;
  detailsUrl: string | null;
};

export type PullRequestMergeReadiness = {
  success: boolean;
  canMerge: boolean;
  reasons: string[];
  allowedMethods: PullRequestMergeMethod[];
  defaultMethod: PullRequestMergeMethod;
  checks: PullRequestCheckSummary;
  checkRuns?: PullRequestCheckRun[];
  pr?: {
    number: number;
    state: "open" | "closed";
    isDraft: boolean;
    baseBranch: string;
    headBranch: string;
    headSha: string;
    headOwner: string | null;
    mergeable: boolean | null;
    mergeableState: string | null;
  };
  error?: string;
};

type MergePullRequestResult = {
  success: boolean;
  sha?: string;
  error?: string;
  statusCode?: number;
};

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

const URL_PATTERN = /https?:\/\/[^\s<>()\]]+/g;
const VERCEL_METADATA_PATTERN = /^\[vc\]:\s*#[^:]+:([A-Za-z0-9+/=_-]+)\s*$/m;

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;:!?]+$/g, "");
}

function isVercelDeploymentUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "vercel.app" ||
      hostname.endsWith(".vercel.app") ||
      hostname === "vercel.dev" ||
      hostname.endsWith(".vercel.dev")
    );
  } catch {
    return false;
  }
}

function normalizeVercelDeploymentUrl(value: string): string | null {
  const trimmed = trimTrailingUrlPunctuation(value.trim());
  if (!trimmed) {
    return null;
  }

  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  return isVercelDeploymentUrl(url) ? url : null;
}

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function extractVercelDeploymentUrlFromMetadata(
  commentBody: string,
): string | null {
  const metadataMatch = commentBody.match(VERCEL_METADATA_PATTERN);
  const encodedPayload = metadataMatch?.[1];
  if (!encodedPayload) {
    return null;
  }

  const decodedPayload = decodeBase64Url(encodedPayload);
  if (!decodedPayload) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodedPayload);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const projects = (parsed as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) {
    return null;
  }

  for (const project of projects) {
    if (!project || typeof project !== "object") {
      continue;
    }

    const previewUrl = (project as { previewUrl?: unknown }).previewUrl;
    if (typeof previewUrl !== "string") {
      continue;
    }

    const deploymentUrl = normalizeVercelDeploymentUrl(previewUrl);
    if (deploymentUrl) {
      return deploymentUrl;
    }
  }

  return null;
}

function extractVercelDeploymentUrl(commentBody: string): string | null {
  const matches = commentBody.match(URL_PATTERN);
  if (matches) {
    for (const match of matches) {
      const deploymentUrl = normalizeVercelDeploymentUrl(match);
      if (deploymentUrl) {
        return deploymentUrl;
      }
    }
  }

  return extractVercelDeploymentUrlFromMetadata(commentBody);
}

const SUCCESSFUL_CHECK_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

const FAILED_CHECK_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "startup_failure",
  "timed_out",
]);

const MERGEABILITY_POLL_DELAY_MS = 200;
const MERGEABILITY_MAX_POLL_ATTEMPTS = 3;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getCheckRunState(
  status: string | null,
  conclusion: string | null,
): PullRequestCheckState {
  if (status !== "completed") {
    return "pending";
  }

  if (conclusion && SUCCESSFUL_CHECK_CONCLUSIONS.has(conclusion)) {
    return "passed";
  }

  if (conclusion && FAILED_CHECK_CONCLUSIONS.has(conclusion)) {
    return "failed";
  }

  if (conclusion === null) {
    return "pending";
  }

  // Remaining conclusions are treated as failures to avoid merging with
  // unknown or unstable check outcomes.
  return "failed";
}

function getCombinedStatusState(state: string): PullRequestCheckState {
  if (state === "success") {
    return "passed";
  }

  if (state === "pending") {
    return "pending";
  }

  return "failed";
}

function summarizeCheckRuns(
  runs: Array<{ status: string | null; conclusion: string | null }>,
): PullRequestCheckSummary {
  let passed = 0;
  let pending = 0;
  let failed = 0;

  for (const run of runs) {
    const state = getCheckRunState(run.status, run.conclusion);

    if (state === "passed") {
      passed += 1;
      continue;
    }

    if (state === "pending") {
      pending += 1;
      continue;
    }

    failed += 1;
  }

  return {
    requiredTotal: runs.length,
    passed,
    pending,
    failed,
  };
}

function summarizeCombinedStatuses(
  statuses: Array<{ state: string }>,
): PullRequestCheckSummary {
  let passed = 0;
  let pending = 0;
  let failed = 0;

  for (const status of statuses) {
    const checkState = getCombinedStatusState(status.state);

    if (checkState === "passed") {
      passed += 1;
      continue;
    }

    if (checkState === "pending") {
      pending += 1;
      continue;
    }

    failed += 1;
  }

  return {
    requiredTotal: statuses.length,
    passed,
    pending,
    failed,
  };
}

function resolveDefaultMergeMethod(
  allowedMethods: PullRequestMergeMethod[],
): PullRequestMergeMethod {
  if (allowedMethods.includes("squash")) {
    return "squash";
  }

  if (allowedMethods.includes("merge")) {
    return "merge";
  }

  return "rebase";
}

function reasonsFromMergeableState(
  mergeableState: string | null,
  isDraft: boolean,
): string[] {
  if (!mergeableState) {
    return [];
  }

  if (isDraft || mergeableState === "draft") {
    return ["Pull request is still in draft mode"];
  }

  if (mergeableState === "dirty") {
    return ["Pull request has merge conflicts"];
  }

  if (mergeableState === "blocked") {
    return ["Branch protection requirements are not yet satisfied"];
  }

  if (mergeableState === "behind") {
    return ["Pull request branch is behind the base branch"];
  }

  if (mergeableState === "unstable") {
    return ["Required checks are still in progress"];
  }

  return [];
}

export async function getPullRequestMergeReadiness(params: {
  repoUrl: string;
  prNumber: number;
  token?: string;
}): Promise<PullRequestMergeReadiness> {
  const { repoUrl, prNumber, token } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return {
        success: false,
        canMerge: false,
        reasons: ["GitHub account not connected"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        checkRuns: [],
        error: "GitHub account not connected",
      };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return {
        success: false,
        canMerge: false,
        reasons: ["Invalid GitHub repository URL"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        checkRuns: [],
        error: "Invalid GitHub repository URL",
      };
    }

    const { owner, repo } = parsed;

    const [initialPullRequestResponse, repositoryResponse] = await Promise.all([
      result.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      }),
      result.octokit.rest.repos.get({ owner, repo }),
    ]);

    let pullRequest = initialPullRequestResponse.data;

    for (
      let attempt = 0;
      attempt < MERGEABILITY_MAX_POLL_ATTEMPTS &&
      pullRequest.mergeable === null;
      attempt += 1
    ) {
      await delay(MERGEABILITY_POLL_DELAY_MS);

      try {
        const refreshedPullRequestResponse =
          await result.octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: prNumber,
          });

        pullRequest = refreshedPullRequestResponse.data;
      } catch (refreshError) {
        console.warn(
          "Failed to refresh pull request mergeability state:",
          refreshError,
        );
        break;
      }
    }

    const repository = repositoryResponse.data;
    const isDraft = Boolean(pullRequest.draft);

    const allowedMethods: PullRequestMergeMethod[] = [];
    if (repository.allow_squash_merge) {
      allowedMethods.push("squash");
    }
    if (repository.allow_merge_commit) {
      allowedMethods.push("merge");
    }
    if (repository.allow_rebase_merge) {
      allowedMethods.push("rebase");
    }

    const defaultMethod =
      allowedMethods.length > 0
        ? resolveDefaultMergeMethod(allowedMethods)
        : "squash";

    let checksSummary: PullRequestCheckSummary = {
      requiredTotal: 0,
      passed: 0,
      pending: 0,
      failed: 0,
    };
    let checkRuns: PullRequestCheckRun[] = [];

    try {
      const checksResponse = await result.octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: pullRequest.head.sha,
        per_page: 100,
      });

      checkRuns = checksResponse.data.check_runs.map((checkRun) => ({
        name: checkRun.name,
        state: getCheckRunState(checkRun.status, checkRun.conclusion),
        status: checkRun.status,
        conclusion: checkRun.conclusion,
        detailsUrl: checkRun.details_url ?? null,
      }));

      checksSummary = summarizeCheckRuns(
        checkRuns.map((checkRun) => ({
          status: checkRun.status,
          conclusion: checkRun.conclusion,
        })),
      );
    } catch (checksError) {
      const checksHttpError = checksError as { status?: number };
      if (checksHttpError.status !== 403 && checksHttpError.status !== 404) {
        console.warn(
          "Failed to list check runs for merge readiness:",
          checksError,
        );
      }
    }

    if (checksSummary.requiredTotal === 0) {
      try {
        const statusesResponse =
          await result.octokit.rest.repos.getCombinedStatusForRef({
            owner,
            repo,
            ref: pullRequest.head.sha,
          });

        const statuses = statusesResponse.data.statuses.map((status) => ({
          state: status.state,
          context: status.context,
          targetUrl: status.target_url,
        }));

        checkRuns = statuses.map((status) => ({
          name: status.context || "Status check",
          state: getCombinedStatusState(status.state),
          status: status.state,
          conclusion: null,
          detailsUrl: status.targetUrl ?? null,
        }));

        checksSummary = summarizeCombinedStatuses(
          statuses.map((status) => ({
            state: status.state,
          })),
        );
      } catch (statusError) {
        const statusHttpError = statusError as { status?: number };
        if (statusHttpError.status !== 403 && statusHttpError.status !== 404) {
          console.warn(
            "Failed to fetch combined status for merge readiness:",
            statusError,
          );
        }
      }
    }

    const reasons = new Set<string>();

    if (pullRequest.state !== "open") {
      reasons.add("Pull request is not open");
    }

    if (isDraft) {
      reasons.add("Pull request is still in draft mode");
    }

    if (pullRequest.mergeable === false) {
      reasons.add("Pull request has merge conflicts");
    }

    if (pullRequest.mergeable === null) {
      reasons.add("GitHub is still calculating mergeability");
    }

    for (const reason of reasonsFromMergeableState(
      pullRequest.mergeable_state,
      isDraft,
    )) {
      reasons.add(reason);
    }

    if (checksSummary.failed > 0) {
      reasons.add("Required checks are failing");
    }

    if (checksSummary.pending > 0) {
      reasons.add("Required checks are still pending");
    }

    if (allowedMethods.length === 0) {
      reasons.add("Repository has no enabled merge methods");
    }

    return {
      success: true,
      canMerge: reasons.size === 0,
      reasons: Array.from(reasons),
      allowedMethods,
      defaultMethod,
      checks: checksSummary,
      checkRuns,
      pr: {
        number: pullRequest.number,
        state: pullRequest.state,
        isDraft,
        baseBranch: pullRequest.base.ref,
        headBranch: pullRequest.head.ref,
        headSha: pullRequest.head.sha,
        headOwner: pullRequest.head.repo?.owner.login ?? null,
        mergeable: pullRequest.mergeable,
        mergeableState: pullRequest.mergeable_state,
      },
    };
  } catch (error: unknown) {
    console.error("Error checking PR merge readiness:", error);

    const httpError = error as { status?: number };
    if (httpError.status === 404) {
      return {
        success: false,
        canMerge: false,
        reasons: ["Pull request not found"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        checkRuns: [],
        error: "Pull request not found",
      };
    }

    if (httpError.status === 403) {
      return {
        success: false,
        canMerge: false,
        reasons: ["Permission denied"],
        allowedMethods: ["squash"],
        defaultMethod: "squash",
        checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
        checkRuns: [],
        error: "Permission denied",
      };
    }

    return {
      success: false,
      canMerge: false,
      reasons: ["Failed to check pull request readiness"],
      allowedMethods: ["squash"],
      defaultMethod: "squash",
      checks: { requiredTotal: 0, passed: 0, pending: 0, failed: 0 },
      checkRuns: [],
      error: "Failed to check pull request readiness",
    };
  }
}

export async function createPullRequest(params: {
  repoUrl: string;
  branchName: string;
  headRef?: string;
  title: string;
  body?: string;
  baseBranch?: string;
  isDraft?: boolean;
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
    isDraft = false,
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
      draft: isDraft,
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
  mergeMethod?: PullRequestMergeMethod;
  expectedHeadSha?: string;
  commitTitle?: string;
  commitMessage?: string;
  token?: string;
}): Promise<MergePullRequestResult> {
  const {
    repoUrl,
    prNumber,
    mergeMethod = "squash",
    expectedHeadSha,
    commitTitle,
    commitMessage,
    token,
  } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return {
        success: false,
        error: "GitHub account not connected",
        statusCode: 401,
      };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return {
        success: false,
        error: "Invalid GitHub repository URL",
        statusCode: 400,
      };
    }

    const { owner, repo } = parsed;

    const response = await result.octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
      ...(expectedHeadSha ? { sha: expectedHeadSha } : {}),
      ...(commitTitle?.trim() ? { commit_title: commitTitle.trim() } : {}),
      ...(commitMessage?.trim()
        ? { commit_message: commitMessage.trim() }
        : {}),
    });

    return {
      success: true,
      sha: response.data.sha,
    };
  } catch (error: unknown) {
    console.error("Error merging PR:", error);

    const httpError = error as { status?: number };
    if (httpError.status === 405) {
      return {
        success: false,
        error: "Branch protection requirements are not satisfied",
        statusCode: 405,
      };
    }
    if (httpError.status === 409) {
      return {
        success: false,
        error: "Pull request has conflicts or is out of date",
        statusCode: 409,
      };
    }
    if (httpError.status === 422) {
      return {
        success: false,
        error: "Invalid merge request or pull request already merged",
        statusCode: 422,
      };
    }
    if (httpError.status === 403) {
      return {
        success: false,
        error: "Permission denied",
        statusCode: 403,
      };
    }

    return {
      success: false,
      error: "Failed to merge pull request",
      statusCode: 502,
    };
  }
}

export async function closePullRequest(params: {
  repoUrl: string;
  prNumber: number;
  token?: string;
}): Promise<
  { success: true } | { success: false; error: string; statusCode?: number }
> {
  const { repoUrl, prNumber, token } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return {
        success: false,
        error: "GitHub account not connected",
        statusCode: 401,
      };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return {
        success: false,
        error: "Invalid GitHub repository URL",
        statusCode: 400,
      };
    }

    const { owner, repo } = parsed;

    await result.octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      state: "closed",
    });

    return { success: true };
  } catch (error: unknown) {
    console.error("Error closing PR:", error);

    const httpError = error as { status?: number };
    if (httpError.status === 403) {
      return {
        success: false,
        error: "Permission denied",
        statusCode: 403,
      };
    }
    if (httpError.status === 404) {
      return {
        success: false,
        error: "Pull request not found",
        statusCode: 404,
      };
    }
    if (httpError.status === 422) {
      return {
        success: false,
        error: "Pull request cannot be closed",
        statusCode: 422,
      };
    }

    return {
      success: false,
      error: "Failed to close pull request",
      statusCode: 502,
    };
  }
}

export async function deleteBranchRef(params: {
  repoUrl: string;
  branchName: string;
  token?: string;
}): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  const { repoUrl, branchName, token } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return {
        success: false,
        error: "GitHub account not connected",
        statusCode: 401,
      };
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return {
        success: false,
        error: "Invalid GitHub repository URL",
        statusCode: 400,
      };
    }

    const { owner, repo } = parsed;

    await result.octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });

    return { success: true };
  } catch (error: unknown) {
    console.error("Error deleting branch ref:", error);

    const httpError = error as { status?: number };

    if (httpError.status === 404) {
      return {
        success: false,
        error: "Branch does not exist",
        statusCode: 404,
      };
    }

    if (httpError.status === 422) {
      return {
        success: false,
        error: "Branch cannot be deleted",
        statusCode: 422,
      };
    }

    if (httpError.status === 403) {
      return {
        success: false,
        error: "Permission denied",
        statusCode: 403,
      };
    }

    return {
      success: false,
      error: "Failed to delete branch",
      statusCode: 502,
    };
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

export async function findLatestVercelDeploymentUrlForPullRequest(params: {
  owner: string;
  repo: string;
  prNumber: number;
  token?: string;
}): Promise<{
  success: boolean;
  deploymentUrl?: string;
  error?: string;
}> {
  const { owner, repo, prNumber, token } = params;

  try {
    const result = await getOctokit(token);

    if (!result.authenticated) {
      return { success: false, error: "GitHub account not connected" };
    }

    const response = await result.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });

    // Iterate in reverse since the API returns comments in ascending
    // chronological order and we want the latest deployment URL.
    for (let i = response.data.length - 1; i >= 0; i--) {
      const comment = response.data[i];
      if (!comment.body) {
        continue;
      }

      const deploymentUrl = extractVercelDeploymentUrl(comment.body);
      if (deploymentUrl) {
        return {
          success: true,
          deploymentUrl,
        };
      }
    }

    return { success: true };
  } catch {
    return {
      success: false,
      error: "Failed to find Vercel deployment URL",
    };
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
