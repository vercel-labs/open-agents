"use server";

import { connectSandbox } from "@open-agents/sandbox";
import {
  openPullRequest as openPullRequestOnGitHub,
  enableAutoMerge,
  getMergeReadiness as getMergeReadinessFromGitHub,
  mergePullRequest,
  closePullRequest as closePullRequestOnGitHub,
  deleteBranchRef,
  type MergeMethod,
} from "@/lib/github/pulls";
import { parseGitHubUrl } from "@/lib/github/client";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import { withScopedInstallationOctokit } from "@/lib/github/app";
import { getGitHubAppUserToken, getUserGitHubToken } from "@/lib/github/token";
import { generatePullRequestContentFromSandbox } from "@/lib/github/pr-content";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import { isSafeBranchName } from "@/lib/git/helpers";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type MergePullRequestResult = {
  merged: boolean;
  prNumber: number;
  mergeCommitSha: string | null;
  branchDeleted: boolean;
  branchDeleteError: string | null;
};

export type ClosePullRequestResult = {
  closed: boolean;
  prNumber: number;
};

export interface GeneratePrContentResult {
  title?: string;
  body?: string;
  branchName?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveAppBaseUrl(): string | undefined {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }
  return process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined;
}

function isMergeMethod(value: unknown): value is MergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

function buildGitHubCompareUrl(params: {
  owner: string;
  repo: string;
  baseBranch: string;
  headRef: string;
  title?: string;
  body?: string;
}): string {
  const { owner, repo, baseBranch, headRef, title, body } = params;
  const encodedBaseBranch = encodeURIComponent(baseBranch);
  const encodedHeadRef = encodeURIComponent(headRef);
  const compareUrl = new URL(
    `https://github.com/${owner}/${repo}/compare/${encodedBaseBranch}...${encodedHeadRef}`,
  );
  compareUrl.searchParams.set("expand", "1");

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    compareUrl.searchParams.set("title", trimmedTitle);
  }

  const trimmedBody = body?.trim();
  if (trimmedBody) {
    compareUrl.searchParams.set("body", trimmedBody);
  }

  return compareUrl.toString();
}

function buildManualPullRequestResponse(params: {
  owner: string;
  repo: string;
  baseBranch: string;
  headRef: string;
  title: string;
  body?: string;
  shouldAutoMerge: boolean;
}) {
  return {
    success: true,
    prUrl: buildGitHubCompareUrl(params),
    requiresManualCreation: true,
    ...(params.shouldAutoMerge
      ? {
          autoMergeEnabled: false,
          autoMergeError:
            "Auto-merge can only be enabled for pull requests created through the GitHub API.",
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// server actions
// ---------------------------------------------------------------------------

/**
 * Generate PR title and body from the sandbox diff.
 */
export async function generatePrContent(params: {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
}): Promise<GeneratePrContentResult> {
  const { sessionId, sessionTitle, baseBranch, branchName } = params;

  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== session.user.id) {
    throw new Error("Forbidden");
  }
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    throw new Error("Sandbox not initialized");
  }
  if (!baseBranch || !isSafeBranchName(baseBranch)) {
    throw new Error("Invalid base branch name");
  }
  if (!branchName || (branchName !== "HEAD" && !isSafeBranchName(branchName))) {
    throw new Error("Invalid branch name");
  }

  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  // resolve live branch
  let resolvedBranch = branchName === "HEAD" ? baseBranch : branchName;
  const branchResult = await sandbox.exec(
    "git symbolic-ref --short HEAD",
    cwd,
    10000,
  );
  const liveBranch = branchResult.stdout.trim();
  if (branchResult.success && liveBranch && liveBranch !== "HEAD") {
    resolvedBranch = liveBranch;
  }

  // fetch from origin
  await sandbox.exec(
    `git fetch origin ${baseBranch}:refs/remotes/origin/${baseBranch}`,
    cwd,
    30000,
  );

  // check for uncommitted changes
  const statusResult = await sandbox.exec("git status --porcelain", cwd, 10000);
  if (statusResult.stdout.trim().length > 0) {
    throw new Error(
      "Uncommitted changes — commit first before generating PR content",
    );
  }

  // determine base ref
  let baseRef = baseBranch;

  const originRefCheck = await sandbox.exec(
    `git rev-parse --verify origin/${baseBranch}`,
    cwd,
    10000,
  );
  if (originRefCheck.success && originRefCheck.stdout.trim()) {
    baseRef = `origin/${baseBranch}`;
  } else {
    const localRefCheck = await sandbox.exec(
      `git rev-parse --verify ${baseBranch}`,
      cwd,
      10000,
    );
    if (localRefCheck.success && localRefCheck.stdout.trim()) {
      baseRef = baseBranch;
    } else {
      const fetchHeadCheck = await sandbox.exec(
        "git rev-parse FETCH_HEAD",
        cwd,
        10000,
      );
      if (fetchHeadCheck.success && fetchHeadCheck.stdout.trim()) {
        baseRef = "FETCH_HEAD";
      }
    }
  }

  const appBaseUrl = resolveAppBaseUrl();

  const prContentResult = await generatePullRequestContentFromSandbox({
    sandbox,
    sessionId,
    sessionTitle,
    baseBranch,
    branchName: resolvedBranch,
    baseRef,
    appBaseUrl,
  });

  if (!prContentResult.success) {
    return { error: prContentResult.error };
  }

  return {
    title: prContentResult.title,
    body: prContentResult.body,
    branchName: resolvedBranch,
  };
}

/**
 * Open a pull request on GitHub.
 */
export async function openPullRequest(params: {
  sessionId: string;
  repoUrl: string;
  branchName?: string;
  title: string;
  body?: string;
  baseBranch: string;
  headOwner?: string;
  isDraft?: boolean;
  shouldAutoMerge?: boolean;
}): Promise<{
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  prStatus?: string;
  requiresManualCreation?: boolean;
  autoMergeEnabled?: boolean;
  autoMergeError?: string;
  error?: string;
}> {
  const {
    sessionId,
    repoUrl,
    branchName,
    title,
    body: prBody,
    baseBranch,
    headOwner,
    isDraft = false,
    shouldAutoMerge = false,
  } = params;

  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  if (!sessionId || !repoUrl || !title || !baseBranch) {
    throw new Error("Missing required fields");
  }

  if (isDraft && shouldAutoMerge) {
    throw new Error("Auto-merge is not available for draft pull requests");
  }

  // validate repoUrl format
  const githubUrlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
  if (!githubUrlPattern.test(repoUrl)) {
    throw new Error("Invalid repository URL");
  }

  const parsedRepoUrl = parseGitHubUrl(repoUrl);
  if (!parsedRepoUrl) {
    throw new Error("Invalid repository URL");
  }

  if (!isSafeBranchName(baseBranch)) {
    throw new Error("Invalid base branch name");
  }

  // session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== session.user.id) {
    throw new Error("Forbidden");
  }

  const resolvedBranch = sessionRecord.branch ?? branchName;
  if (!resolvedBranch) {
    throw new Error("Branch name is required");
  }
  if (!isSafeBranchName(resolvedBranch)) {
    throw new Error("Invalid branch name");
  }
  if (headOwner && !isSafeBranchName(headOwner)) {
    throw new Error("Invalid head owner");
  }

  let headRef = resolvedBranch;
  const normalizedBaseOwner = parsedRepoUrl.owner.toLowerCase();
  const normalizedHeadOwner = headOwner?.trim().toLowerCase();

  if (normalizedHeadOwner && normalizedHeadOwner !== normalizedBaseOwner) {
    headRef = `${headOwner}:${resolvedBranch}`;
    return buildManualPullRequestResponse({
      owner: parsedRepoUrl.owner,
      repo: parsedRepoUrl.repo,
      baseBranch,
      headRef,
      title,
      body: prBody,
      shouldAutoMerge,
    });
  }

  const access = await verifyRepoAccess({
    userId: session.user.id,
    owner: parsedRepoUrl.owner,
    repo: parsedRepoUrl.repo,
    requiredUserPermission: "read",
  });

  if (!access.ok) {
    throw new Error(getRepoAccessErrorMessage(access.reason));
  }

  let autoMergeAccess: {
    ok: true;
    installationId: number;
    repositoryId: number;
    defaultBranch: string;
  } | null = null;
  let autoMergeAccessError: string | undefined;

  if (shouldAutoMerge) {
    const writeAccess = await verifyRepoAccess({
      userId: session.user.id,
      owner: parsedRepoUrl.owner,
      repo: parsedRepoUrl.repo,
      requiredUserPermission: "write",
    });

    if (writeAccess.ok) {
      autoMergeAccess = writeAccess;
    } else {
      autoMergeAccessError = getRepoAccessErrorMessage(writeAccess.reason);
    }
  }

  const userToken = await getGitHubAppUserToken(session.user.id);
  if (!userToken) {
    throw new Error("No GitHub token available for pull request creation");
  }

  const result = await openPullRequestOnGitHub({
    repoUrl,
    branchName: resolvedBranch,
    headRef,
    title,
    body: prBody || "",
    baseBranch,
    isDraft,
    token: userToken,
  });

  if (!result.success) {
    const error = result.error || "Failed to create pull request";

    if (error === "Permission denied") {
      return buildManualPullRequestResponse({
        owner: parsedRepoUrl.owner,
        repo: parsedRepoUrl.repo,
        baseBranch,
        headRef,
        title,
        body: prBody,
        shouldAutoMerge,
      });
    }

    return { success: false, error };
  }

  let autoMergeEnabled = false;
  let autoMergeError: string | undefined;

  if (shouldAutoMerge) {
    if (typeof result.prNumber !== "number") {
      autoMergeError =
        "The pull request was created, but auto-merge could not be enabled.";
    } else if (autoMergeAccessError) {
      autoMergeError = autoMergeAccessError;
    } else if (!autoMergeAccess) {
      autoMergeError = "Auto-merge could not be enabled.";
    } else {
      const prNumber = result.prNumber;
      const autoMergeResult = await withScopedInstallationOctokit({
        installationId: autoMergeAccess.installationId,
        repositoryId: autoMergeAccess.repositoryId,
        permissions: { contents: "read", pull_requests: "write" },
        operation: async (octokit) =>
          enableAutoMerge({
            repoUrl,
            prNumber,
            octokit,
            ...(result.nodeId ? { nodeId: result.nodeId } : {}),
          }),
      });

      if (autoMergeResult.success) {
        autoMergeEnabled = true;
      } else {
        autoMergeError = autoMergeResult.error || "Failed to enable auto-merge";
      }
    }
  }

  await updateSession(sessionId, {
    prNumber: result.prNumber,
    prStatus: "open",
  }).catch((err) => {
    console.error(`Failed to update session ${sessionId} with PR info`, err);
  });

  return {
    success: true,
    prUrl: result.prUrl,
    prNumber: result.prNumber,
    prStatus: "open",
    ...(shouldAutoMerge ? { autoMergeEnabled, autoMergeError } : {}),
  };
}

/**
 * Merge a pull request on GitHub.
 */
export async function mergePr(params: {
  sessionId: string;
  mergeMethod?: MergeMethod;
  commitTitle?: string;
  commitMessage?: string;
  deleteBranch?: boolean;
  expectedHeadSha?: string;
  force?: boolean;
}): Promise<MergePullRequestResult> {
  const {
    sessionId,
    mergeMethod,
    commitTitle,
    commitMessage,
    deleteBranch,
    expectedHeadSha: rawExpectedHeadSha,
    force,
  } = params;

  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== session.user.id) {
    throw new Error("Forbidden");
  }

  if (
    !sessionRecord.cloneUrl ||
    !sessionRecord.repoOwner ||
    !sessionRecord.repoName
  ) {
    throw new Error("Session is not linked to a GitHub repository");
  }
  if (!sessionRecord.prNumber) {
    throw new Error("No pull request found for this session");
  }
  const repoUrl = sessionRecord.cloneUrl;
  const repoOwner = sessionRecord.repoOwner;
  const repoName = sessionRecord.repoName;
  const prNumber = sessionRecord.prNumber;

  if (sessionRecord.prStatus === "merged") {
    return {
      merged: true,
      prNumber,
      mergeCommitSha: null,
      branchDeleted: false,
      branchDeleteError: null,
    };
  }

  if (sessionRecord.prStatus === "closed") {
    throw new Error("Pull request is closed");
  }

  if (rawExpectedHeadSha && !/^[a-f0-9]{7,40}$/i.test(rawExpectedHeadSha)) {
    throw new Error("Invalid expected head SHA");
  }

  if (mergeMethod !== undefined && !isMergeMethod(mergeMethod)) {
    throw new Error("Invalid merge method");
  }

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    throw new Error("No GitHub token available for this repository");
  }

  const access = await verifyRepoAccess({
    userId: session.user.id,
    owner: repoOwner,
    repo: repoName,
    requiredUserPermission: "write",
  });

  if (!access.ok) {
    throw new Error(getRepoAccessErrorMessage(access.reason));
  }

  const readiness = await getMergeReadinessFromGitHub({
    repoUrl,
    prNumber,
    token,
  });

  if (!readiness.success || !readiness.pr) {
    throw new Error(
      readiness.error ?? "Failed to check pull request readiness",
    );
  }
  const pullRequest = readiness.pr;

  const expectedHeadSha = rawExpectedHeadSha ?? pullRequest.headSha;

  if (expectedHeadSha !== pullRequest.headSha) {
    throw new Error(
      "Pull request has new commits. Refresh and review before merging.",
    );
  }

  // reasons that can be bypassed with force (CI/check failures only)
  const forceBypassableReasons = new Set([
    "Required checks are failing",
    "Required checks are still pending",
    "Required checks are still in progress",
    "Branch protection requirements are not yet satisfied",
  ]);

  if (!readiness.canMerge) {
    const nonBypassableReasons = readiness.reasons.filter(
      (r) => !forceBypassableReasons.has(r),
    );

    if (!force || nonBypassableReasons.length > 0) {
      const reasons = force ? nonBypassableReasons : readiness.reasons;
      throw new Error(reasons.join(". "));
    }
  }

  const requestedMethod = mergeMethod ?? readiness.defaultMethod;
  if (!readiness.allowedMethods.includes(requestedMethod)) {
    throw new Error("Selected merge method is not allowed for this repository");
  }

  const mergeResult = await withScopedInstallationOctokit({
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    permissions: { contents: "write", pull_requests: "write" },
    operation: async (octokit) =>
      mergePullRequest({
        repoUrl,
        prNumber,
        mergeMethod: requestedMethod,
        expectedHeadSha,
        octokit,
        ...(commitTitle ? { commitTitle } : {}),
        ...(commitMessage ? { commitMessage } : {}),
      }),
  });

  if (!mergeResult.success) {
    throw new Error(mergeResult.error ?? "Failed to merge pull request");
  }

  let branchDeleted = false;
  let branchDeleteError: string | null = null;
  const shouldDeleteBranch = deleteBranch ?? true;

  if (shouldDeleteBranch && pullRequest.headBranch) {
    const headBranch = pullRequest.headBranch;
    const normalizedRepoOwner = repoOwner.toLowerCase();
    const normalizedHeadOwner = pullRequest.headOwner?.toLowerCase() ?? null;

    if (!normalizedHeadOwner) {
      branchDeleteError =
        "Source branch owner could not be determined; branch was not deleted";
    } else if (normalizedHeadOwner !== normalizedRepoOwner) {
      branchDeleteError = "Source branch belongs to a fork and was not deleted";
    } else {
      const deleteResult = await withScopedInstallationOctokit({
        installationId: access.installationId,
        repositoryId: access.repositoryId,
        permissions: { contents: "write" },
        operation: async (octokit) =>
          deleteBranchRef({
            repoUrl,
            branchName: headBranch,
            octokit,
          }),
      });

      if (deleteResult.success || deleteResult.statusCode === 404) {
        branchDeleted = true;
      } else if (deleteResult.error) {
        branchDeleteError = deleteResult.error;
      }
    }
  }

  await updateSession(sessionRecord.id, { prStatus: "merged" });

  return {
    merged: true,
    prNumber,
    mergeCommitSha: mergeResult.sha ?? null,
    branchDeleted,
    branchDeleteError,
  };
}

/**
 * Close a pull request on GitHub without merging.
 */
export async function closePr(params: {
  sessionId: string;
}): Promise<ClosePullRequestResult> {
  const { sessionId } = params;

  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== session.user.id) {
    throw new Error("Forbidden");
  }

  if (
    !sessionRecord.cloneUrl ||
    !sessionRecord.repoOwner ||
    !sessionRecord.repoName
  ) {
    throw new Error("Session is not linked to a GitHub repository");
  }
  if (!sessionRecord.prNumber) {
    throw new Error("No pull request found for this session");
  }
  const repoUrl = sessionRecord.cloneUrl;
  const repoOwner = sessionRecord.repoOwner;
  const repoName = sessionRecord.repoName;
  const prNumber = sessionRecord.prNumber;

  if (sessionRecord.prStatus === "merged") {
    throw new Error("Pull request is already merged");
  }

  if (sessionRecord.prStatus === "closed") {
    return {
      closed: true,
      prNumber,
    };
  }

  const access = await verifyRepoAccess({
    userId: session.user.id,
    owner: repoOwner,
    repo: repoName,
    requiredUserPermission: "write",
  });

  if (!access.ok) {
    throw new Error(getRepoAccessErrorMessage(access.reason));
  }

  const closeResult = await withScopedInstallationOctokit({
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    permissions: { pull_requests: "write" },
    operation: async (octokit) =>
      closePullRequestOnGitHub({
        repoUrl,
        prNumber,
        octokit,
      }),
  });

  if (!closeResult.success) {
    throw new Error(closeResult.error ?? "Failed to close pull request");
  }

  await updateSession(sessionRecord.id, { prStatus: "closed" });

  return {
    closed: true,
    prNumber,
  };
}
