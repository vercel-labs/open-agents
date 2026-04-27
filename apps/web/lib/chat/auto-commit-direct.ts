import type { Sandbox } from "@open-agents/sandbox";
import {
  hasUncommittedChanges,
  stageAll,
  getCurrentBranch,
  getStagedDiff,
  getChangedFiles,
  readFileContents,
  syncToRemote,
} from "@open-agents/sandbox";
import { generateText } from "ai";
import { gateway } from "@open-agents/agent";
import { getInstallationOctokit } from "@/lib/github/app";
import { verifyRepoAccess } from "@/lib/github/access";
import { createCommit, buildCoAuthor } from "@/lib/github/commit";

export interface AutoCommitParams {
  sandbox: Sandbox;
  userId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
  /** base branch for new branches that don't exist on remote yet */
  baseBranch?: string;
}

export interface AutoCommitResult {
  committed: boolean;
  pushed: boolean;
  commitMessage?: string;
  commitSha?: string;
  error?: string;
}

/**
 * Performs an auto-commit via the GitHub API (verified/signed commits).
 * Stages changes, generates a commit message, creates the commit via API,
 * then syncs the sandbox to match the new remote HEAD.
 */
export async function performAutoCommit(
  params: AutoCommitParams,
): Promise<AutoCommitResult> {
  const {
    sandbox,
    userId,
    sessionId,
    sessionTitle,
    repoOwner,
    repoName,
    baseBranch,
  } = params;

  // 1. check for uncommitted changes
  if (!(await hasUncommittedChanges(sandbox))) {
    return { committed: false, pushed: false };
  }

  // 2. stage all changes
  try {
    await stageAll(sandbox);
  } catch {
    return {
      committed: false,
      pushed: false,
      error: "Failed to stage changes",
    };
  }

  // 3. generate commit message from staged diff
  const commitMessage = await generateCommitMessage(sandbox, sessionTitle);

  // 4. verify repo access and get installation
  const access = await verifyRepoAccess({
    userId,
    owner: repoOwner,
    repo: repoName,
  });

  if (!access.ok) {
    return {
      committed: false,
      pushed: false,
      error: `Cannot commit: ${access.reason}`,
    };
  }

  // 5. resolve user for co-author attribution
  const coAuthor = await buildCoAuthor(userId);

  const changes = await getChangedFiles(sandbox);
  if (changes.length === 0) {
    return { committed: false, pushed: false };
  }

  const files = await readFileContents(sandbox, changes);

  // 6. create verified commit via github api
  const branch = await getCurrentBranch(sandbox);
  const octokit = getInstallationOctokit(access.installationId);

  const result = await createCommit({
    octokit,
    owner: repoOwner,
    repo: repoName,
    branch,
    baseBranch,
    message: commitMessage,
    files,
    coAuthor: coAuthor ?? undefined,
  });

  if (!result.ok) {
    console.warn(
      `[auto-commit] API commit failed for session ${sessionId}: ${result.error}`,
    );
    return {
      committed: false,
      pushed: false,
      error: result.error,
    };
  }

  // 8. sync sandbox to match the new remote head
  try {
    await syncToRemote(sandbox, branch);
  } catch (error) {
    console.warn(
      `[auto-commit] Sandbox sync failed for session ${sessionId}:`,
      error,
    );
    // commit succeeded on remote even if sandbox sync fails
  }

  console.log(
    `[auto-commit] Successfully committed (verified) for session ${sessionId}`,
  );

  return {
    committed: true,
    pushed: true,
    commitMessage,
    commitSha: result.commitSha,
  };
}

async function generateCommitMessage(
  sandbox: Sandbox,
  sessionTitle: string,
): Promise<string> {
  const fallback = "chore: update repository changes";

  try {
    const diffForCommit = await getStagedDiff(sandbox);

    if (!diffForCommit.trim()) {
      return fallback;
    }

    const result = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Session context: ${sessionTitle}

Diff:
${diffForCommit.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
    });

    const generated = result.text.trim().split("\n")[0]?.trim();
    if (generated && generated.length > 0) {
      return generated.slice(0, 72);
    }
  } catch (error) {
    console.warn("[auto-commit] Failed to generate commit message:", error);
  }

  return fallback;
}
