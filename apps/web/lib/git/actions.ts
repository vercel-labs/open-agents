"use server";

import {
  connectSandbox,
  stageAll,
  getStagedDiff,
  getChangedFiles,
  readFileContents,
  syncToRemote,
  hasUncommittedChanges as checkUncommitted,
} from "@open-agents/sandbox";
import { generateText } from "ai";
import { gateway } from "@open-agents/agent";
import { getInstallationOctokit } from "@/lib/github/app";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import { createCommit, buildCoAuthor } from "@/lib/github/commit";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  generateBranchName,
  looksLikeCommitHash,
} from "@/app/api/generate-pr/_lib/generate-pr-helpers";

export interface CommitResult {
  committed: boolean;
  pushed: boolean;
  branchName?: string;
  commitMessage?: string;
  commitSha?: string;
  error?: string;
}

const SAFE_BRANCH_PATTERN = /^[\w\-/.]+$/;

async function generateCommitMessage(
  diff: string,
  sessionTitle: string,
): Promise<string> {
  const fallback = "chore: update repository changes";
  if (!diff.trim()) return fallback;

  try {
    const result = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Session context: ${sessionTitle}

Diff:
${diff.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
    });

    const generated = result.text.trim().split("\n")[0]?.trim();
    if (generated && generated.length > 0) {
      return generated.slice(0, 72);
    }
  } catch (error) {
    console.warn("[commit] failed to generate commit message:", error);
  }

  return fallback;
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

  if (!baseBranch || !SAFE_BRANCH_PATTERN.test(baseBranch)) {
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

  if (!SAFE_BRANCH_PATTERN.test(resolvedBranch)) {
    return { committed: false, pushed: false, error: "Invalid branch name" };
  }

  if (resolvedBranch !== branchName) {
    await updateSession(sessionId, { branch: resolvedBranch }).catch(() => {});
  }

  // check for changes
  if (!(await checkUncommitted(sandbox))) {
    return { committed: false, pushed: false, branchName: resolvedBranch };
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

  // verify access
  const access = await verifyRepoAccess({
    userId: session.user.id,
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
  });

  if (!access.ok) {
    return {
      committed: false,
      pushed: false,
      error: getRepoAccessErrorMessage(access.reason),
    };
  }

  // read changed files
  const changes = await getChangedFiles(sandbox);
  if (changes.length === 0) {
    return { committed: false, pushed: false, branchName: resolvedBranch };
  }

  const files = await readFileContents(sandbox, changes);
  const coAuthor = await buildCoAuthor(session.user.id);

  // build message
  const messageParts = [commitMessage];
  if (useManualMessage && normalizedBody.length > 0) {
    messageParts.push(normalizedBody);
  }
  const fullMessage = messageParts.join("\n\n");

  // commit
  const octokit = getInstallationOctokit(access.installationId);
  const result = await createCommit({
    octokit,
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
    branch: resolvedBranch,
    baseBranch,
    message: fullMessage,
    files,
    coAuthor: coAuthor ?? undefined,
  });

  if (!result.ok) {
    return { committed: false, pushed: false, error: result.error };
  }

  // sync sandbox
  try {
    await syncToRemote(sandbox, resolvedBranch);
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
