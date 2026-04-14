import type { Sandbox } from "@open-harness/sandbox";
import { looksLikeCommitHash } from "@/app/api/generate-pr/_lib/generate-pr-helpers";
import { updateSession } from "@/lib/db/sessions";
import {
  createPullRequest,
  findPullRequestByBranch,
} from "@/lib/github/client";
import { fetchGitHubBranches } from "@/lib/github/api";
import {
  buildGitHubAuthRemoteUrl,
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
} from "@/lib/github/repo-identifiers";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { generatePullRequestContentFromSandbox } from "@/lib/git/pr-content";

const SAFE_BRANCH_PATTERN = /^[\w\-/.]+$/;

export interface AutoCreatePrParams {
  sandbox: Sandbox;
  userId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
}

export interface AutoCreatePrResult {
  created: boolean;
  syncedExisting: boolean;
  skipped: boolean;
  skipReason?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
}

function parseOriginHeadRef(output: string): string | null {
  const trimmed = output.trim();
  const match = trimmed.match(/^refs\/remotes\/origin\/(.+)$/);
  return match?.[1] ?? null;
}

function isSkippablePrContentError(error: string): boolean {
  return (
    error.startsWith("No changes found:") ||
    error.startsWith("No changes detected between") ||
    error.startsWith("There are uncommitted changes")
  );
}

async function resolveDefaultBranch(params: {
  sandbox: Sandbox;
  repoOwner: string;
  repoName: string;
  token: string;
}): Promise<string | null> {
  const { sandbox, repoOwner, repoName, token } = params;
  const cwd = sandbox.workingDirectory;

  const branchData = await fetchGitHubBranches(token, repoOwner, repoName);

  if (branchData?.defaultBranch?.trim()) {
    return branchData.defaultBranch.trim();
  }

  const originHeadResult = await sandbox.exec(
    "git symbolic-ref refs/remotes/origin/HEAD",
    cwd,
    10000,
  );

  return parseOriginHeadRef(originHeadResult.stdout);
}

async function findExistingOpenPullRequest(params: {
  repoOwner: string;
  repoName: string;
  branchName: string;
  token: string;
}): Promise<Awaited<ReturnType<typeof findPullRequestByBranch>> | null> {
  const { repoOwner, repoName, branchName, token } = params;

  const prResult = await findPullRequestByBranch({
    owner: repoOwner,
    repo: repoName,
    branchName,
    token,
  });

  if (prResult.found && prResult.prStatus === "open") {
    return prResult;
  }

  return null;
}

export async function performAutoCreatePr(
  params: AutoCreatePrParams,
): Promise<AutoCreatePrResult> {
  const { sandbox, userId, sessionId, sessionTitle, repoOwner, repoName } =
    params;
  const cwd = sandbox.workingDirectory;

  const branchResult = await sandbox.exec(
    "git symbolic-ref --short HEAD",
    cwd,
    5000,
  );
  const branchName = branchResult.success ? branchResult.stdout.trim() : "";

  if (!branchName || branchName === "HEAD" || looksLikeCommitHash(branchName)) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is detached",
    };
  }

  if (!SAFE_BRANCH_PATTERN.test(branchName)) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch name is not supported for auto PR creation",
    };
  }

  if (!isValidGitHubRepoOwner(repoOwner) || !isValidGitHubRepoName(repoName)) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason:
        "Repository owner or name is not supported for auto PR creation",
    };
  }

  const userToken = await getUserGitHubToken(userId);
  if (!userToken) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "No GitHub token available for this repository",
    };
  }

  const authUrl = buildGitHubAuthRemoteUrl({
    token: userToken,
    owner: repoOwner,
    repo: repoName,
  });

  if (!authUrl) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason:
        "Repository owner or name is not supported for auto PR creation",
    };
  }

  await sandbox.exec(`git remote set-url origin "${authUrl}"`, cwd, 10000);

  const defaultBranch = await resolveDefaultBranch({
    sandbox,
    repoOwner,
    repoName,
    token: userToken,
  });

  if (!defaultBranch) {
    return {
      created: false,
      syncedExisting: false,
      skipped: false,
      error: "Failed to resolve the repository default branch",
    };
  }

  if (!SAFE_BRANCH_PATTERN.test(defaultBranch)) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Default branch name is not supported for auto PR creation",
    };
  }

  if (branchName === defaultBranch) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch matches the default branch",
    };
  }

  await sandbox.exec(
    `git fetch origin ${defaultBranch}:refs/remotes/origin/${defaultBranch}`,
    cwd,
    30000,
  );

  const remoteBranchResult = await sandbox.exec(
    `git ls-remote --heads origin ${branchName}`,
    cwd,
    10000,
  );

  if (!remoteBranchResult.success || !remoteBranchResult.stdout.trim()) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is not available on origin",
    };
  }

  const localHeadResult = await sandbox.exec("git rev-parse HEAD", cwd, 5000);
  const localHead = localHeadResult.success
    ? localHeadResult.stdout.trim()
    : "";
  const remoteHead = remoteBranchResult.stdout.trim().split(/\s+/)[0] ?? "";

  if (!localHead || !remoteHead) {
    return {
      created: false,
      syncedExisting: false,
      skipped: false,
      error: "Failed to resolve local or remote branch HEAD",
    };
  }

  if (remoteHead !== localHead) {
    return {
      created: false,
      syncedExisting: false,
      skipped: true,
      skipReason: "Current branch is not fully pushed to origin",
    };
  }

  const existingPr = await findExistingOpenPullRequest({
    repoOwner,
    repoName,
    branchName,
    token: userToken,
  });

  if (existingPr?.prNumber) {
    await updateSession(sessionId, {
      prNumber: existingPr.prNumber,
      prStatus: "open",
    }).catch((error) => {
      console.error(
        `[auto-pr] Failed to sync existing PR metadata for session ${sessionId}:`,
        error,
      );
    });

    console.log(
      `[auto-pr] Reused existing PR #${existingPr.prNumber} for session ${sessionId}`,
    );

    return {
      created: false,
      syncedExisting: true,
      skipped: false,
      prNumber: existingPr.prNumber,
      prUrl: existingPr.prUrl,
    };
  }

  const prContentResult = await generatePullRequestContentFromSandbox({
    sandbox,
    sessionId,
    sessionTitle,
    baseBranch: defaultBranch,
    branchName,
  });

  if (!prContentResult.success) {
    if (isSkippablePrContentError(prContentResult.error)) {
      return {
        created: false,
        syncedExisting: false,
        skipped: true,
        skipReason: prContentResult.error,
      };
    }

    return {
      created: false,
      syncedExisting: false,
      skipped: false,
      error: prContentResult.error,
    };
  }

  const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
  const createResult = await createPullRequest({
    repoUrl,
    branchName,
    title: prContentResult.title,
    body: prContentResult.body,
    baseBranch: defaultBranch,
    token: userToken,
  });

  if (!createResult?.success) {
    if (createResult?.error === "PR already exists or branch not found") {
      const detectedPr = await findExistingOpenPullRequest({
        repoOwner,
        repoName,
        branchName,
        token: userToken,
      });

      if (detectedPr?.prNumber) {
        await updateSession(sessionId, {
          prNumber: detectedPr.prNumber,
          prStatus: "open",
        }).catch((error) => {
          console.error(
            `[auto-pr] Failed to sync raced PR metadata for session ${sessionId}:`,
            error,
          );
        });

        return {
          created: false,
          syncedExisting: true,
          skipped: false,
          prNumber: detectedPr.prNumber,
          prUrl: detectedPr.prUrl,
        };
      }
    }

    return {
      created: false,
      syncedExisting: false,
      skipped: false,
      error: createResult?.error ?? "Failed to create pull request",
    };
  }

  if (createResult.prNumber) {
    await updateSession(sessionId, {
      prNumber: createResult.prNumber,
      prStatus: "open",
    }).catch((error) => {
      console.error(
        `[auto-pr] Failed to persist PR metadata for session ${sessionId}:`,
        error,
      );
    });
  }

  console.log(
    `[auto-pr] Created PR #${createResult.prNumber ?? "unknown"} for session ${sessionId}`,
  );

  return {
    created: true,
    syncedExisting: false,
    skipped: false,
    prNumber: createResult.prNumber,
    prUrl: createResult.prUrl,
  };
}
