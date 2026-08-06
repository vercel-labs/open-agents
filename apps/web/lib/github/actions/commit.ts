"use server";

import {
  connectSandbox,
  stageAll,
  getStagedDiff,
  syncToRemote,
  syncToRemotePreservingChanges,
  withTemporaryGitHubAuth,
  hasUncommittedChanges as checkUncommitted,
} from "@open-agents/sandbox";
import {
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
} from "@/lib/github/app";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import { buildCommitIntentFromSandbox } from "@/lib/github/commit-intent";
import { createCommit, buildCoAuthor } from "@/lib/github/commit";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  generateBranchName,
  generateCommitMessage,
  isSafeBranchName,
  looksLikeCommitHash,
} from "@/lib/git/helpers";

function toGitErrorMessage(result: {
  stderr?: string;
  stdout?: string;
}): string {
  return result.stderr?.trim() || result.stdout?.trim() || "Git command failed";
}

async function hasCommitsToPush(params: {
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  cwd: string;
}): Promise<boolean> {
  const result = await params.sandbox.exec(
    "git rev-list @{upstream}..HEAD 2>/dev/null || echo 'needs-push'",
    params.cwd,
    10000,
  );

  return (
    result.stdout.includes("needs-push") || result.stdout.trim().length > 0
  );
}

async function pushBranchToRemote(params: {
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  cwd: string;
  branch: string;
  installationId: number;
  repositoryId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const syncToken = await mintInstallationToken({
    installationId: params.installationId,
    repositoryIds: [params.repositoryId],
    permissions: { contents: "write" },
  });

  try {
    const pushResult = await withTemporaryGitHubAuth(
      params.sandbox,
      syncToken.token,
      () =>
        params.sandbox.exec(
          `GIT_TERMINAL_PROMPT=0 git push -u origin ${params.branch}`,
          params.cwd,
          60000,
        ),
    );

    if (!pushResult.success) {
      return { ok: false, error: toGitErrorMessage(pushResult) };
    }

    return { ok: true };
  } finally {
    await revokeInstallationToken(syncToken.token);
  }
}

export interface CommitResult {
  committed: boolean;
  pushed: boolean;
  branchName?: string;
  commitMessage?: string;
  commitSha?: string;
  error?: string;
}

/**
 * Commit and push changes from a session's sandbox.
 * Creates a verified commit via the GitHub API.
 */
export async function commitChanges(params: {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  commitTitle?: string;
  commitBody?: string;
}): Promise<CommitResult> {
  const {
    sessionId,
    sessionTitle,
    baseBranch,
    branchName,
    commitTitle,
    commitBody,
  } = params;

  // auth
  const session = await getServerSession();
  if (!session?.user) {
    return { committed: false, pushed: false, error: "Not authenticated" };
  }

  // session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return { committed: false, pushed: false, error: "Session not found" };
  }
  if (sessionRecord.userId !== session.user.id) {
    return { committed: false, pushed: false, error: "Forbidden" };
  }
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return {
      committed: false,
      pushed: false,
      error: "Sandbox not initialized",
    };
  }
  if (!sessionRecord.repoOwner || !sessionRecord.repoName) {
    return { committed: false, pushed: false, error: "No repository linked" };
  }

  if (!baseBranch || !isSafeBranchName(baseBranch)) {
    return { committed: false, pushed: false, error: "Invalid base branch" };
  }

  // connect to sandbox
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  // resolve branch
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

  // create branch if on base or detached
  const isDetachedOrOnBase =
    resolvedBranch === baseBranch || looksLikeCommitHash(resolvedBranch);

  if (isDetachedOrOnBase) {
    const generatedBranch = generateBranchName(
      session.user.username,
      session.user.name,
    );
    if (!isSafeBranchName(generatedBranch)) {
      return {
        committed: false,
        pushed: false,
        error: "Invalid generated branch name",
      };
    }
    const checkoutResult = await sandbox.exec(
      `git checkout -b ${generatedBranch}`,
      cwd,
      10000,
    );
    if (!checkoutResult.success) {
      return {
        committed: false,
        pushed: false,
        error: `Failed to create branch: ${checkoutResult.stdout}`,
      };
    }
    resolvedBranch = generatedBranch;
  }

  if (!isSafeBranchName(resolvedBranch)) {
    return { committed: false, pushed: false, error: "Invalid branch name" };
  }

  if (resolvedBranch !== branchName) {
    await updateSession(sessionId, { branch: resolvedBranch }).catch(() => {});
  }

  if (await checkUncommitted(sandbox)) {
    const access = await verifyRepoAccess({
      userId: session.user.id,
      owner: sessionRecord.repoOwner,
      repo: sessionRecord.repoName,
      requiredUserPermission: "write",
    });

    if (!access.ok) {
      return {
        committed: false,
        pushed: false,
        branchName: resolvedBranch,
        error: getRepoAccessErrorMessage(access.reason),
      };
    }

    try {
      const syncToken = await mintInstallationToken({
        installationId: access.installationId,
        repositoryIds: [access.repositoryId],
        permissions: { contents: "read" },
      });
      try {
        await withTemporaryGitHubAuth(sandbox, syncToken.token, () =>
          syncToRemotePreservingChanges(sandbox, resolvedBranch),
        );
      } finally {
        await revokeInstallationToken(syncToken.token);
      }
    } catch (error) {
      console.warn("[commit] pre-commit sandbox sync failed:", error);
      return {
        committed: false,
        pushed: false,
        branchName: resolvedBranch,
        error: "Failed to sync latest remote changes before committing",
      };
    }
  }

  // check for changes
  if (!(await checkUncommitted(sandbox))) {
    if (!(await hasCommitsToPush({ sandbox, cwd }))) {
      return { committed: false, pushed: false, branchName: resolvedBranch };
    }

    const access = await verifyRepoAccess({
      userId: session.user.id,
      owner: sessionRecord.repoOwner,
      repo: sessionRecord.repoName,
      requiredUserPermission: "write",
    });

    if (!access.ok) {
      return {
        committed: false,
        pushed: false,
        branchName: resolvedBranch,
        error: getRepoAccessErrorMessage(access.reason),
      };
    }

    const pushResult = await pushBranchToRemote({
      sandbox,
      cwd,
      branch: resolvedBranch,
      installationId: access.installationId,
      repositoryId: access.repositoryId,
    });

    if (!pushResult.ok) {
      return {
        committed: false,
        pushed: false,
        branchName: resolvedBranch,
        error: `Failed to push commits: ${pushResult.error}`,
      };
    }

    return { committed: false, pushed: true, branchName: resolvedBranch };
  }

  // stage
  try {
    await stageAll(sandbox);
  } catch {
    return {
      committed: false,
      pushed: false,
      error: "Failed to stage changes",
    };
  }

  // generate commit message
  const normalizedTitle = commitTitle?.trim() ?? "";
  const normalizedBody = commitBody?.trim() ?? "";
  const useManualMessage = normalizedTitle.length > 0;

  let commitMessage: string;
  if (useManualMessage) {
    commitMessage = normalizedTitle.slice(0, 72);
  } else {
    const diff = await getStagedDiff(sandbox);
    commitMessage = await generateCommitMessage(diff, sessionTitle);
  }

  const access = await verifyRepoAccess({
    userId: session.user.id,
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
    requiredUserPermission: "write",
  });

  if (!access.ok) {
    return {
      committed: false,
      pushed: false,
      error: getRepoAccessErrorMessage(access.reason),
    };
  }

  const coAuthor = await buildCoAuthor(session.user.id);

  // build message
  const messageParts = [commitMessage];
  if (useManualMessage && normalizedBody.length > 0) {
    messageParts.push(normalizedBody);
  }
  const fullMessage = messageParts.join("\n\n");

  const intentResult = await buildCommitIntentFromSandbox({
    sandbox,
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
    repositoryId: access.repositoryId,
    installationId: access.installationId,
    branch: resolvedBranch,
    baseBranch,
    message: fullMessage,
    ...(coAuthor ? { coAuthor } : {}),
  });

  if (!intentResult.ok) {
    if (intentResult.empty) {
      return { committed: false, pushed: false, branchName: resolvedBranch };
    }
    return { committed: false, pushed: false, error: intentResult.error };
  }

  // commit
  const result = await withScopedInstallationOctokit({
    installationId: intentResult.intent.installationId,
    repositoryId: intentResult.intent.repositoryId,
    permissions: { contents: "write" },
    operation: async (octokit) =>
      createCommit({
        octokit,
        owner: intentResult.intent.owner,
        repo: intentResult.intent.repo,
        branch: intentResult.intent.branch,
        expectedHeadSha: intentResult.intent.expectedHeadSha,
        message: intentResult.intent.message,
        files: intentResult.intent.files,
        ...(intentResult.intent.baseBranch
          ? { baseBranch: intentResult.intent.baseBranch }
          : {}),
        ...(intentResult.intent.coAuthor
          ? { coAuthor: intentResult.intent.coAuthor }
          : {}),
      }),
  });

  if (!result.ok) {
    return { committed: false, pushed: false, error: result.error };
  }

  // sync sandbox
  try {
    const syncToken = await mintInstallationToken({
      installationId: intentResult.intent.installationId,
      repositoryIds: [intentResult.intent.repositoryId],
      permissions: { contents: "read" },
    });
    try {
      await withTemporaryGitHubAuth(sandbox, syncToken.token, () =>
        syncToRemote(sandbox, resolvedBranch),
      );
    } finally {
      await revokeInstallationToken(syncToken.token);
    }
  } catch (error) {
    console.warn("[commit] sandbox sync failed:", error);
  }

  return {
    committed: true,
    pushed: true,
    branchName: resolvedBranch,
    commitMessage,
    commitSha: result.commitSha,
  };
}
