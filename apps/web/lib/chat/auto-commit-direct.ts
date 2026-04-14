import type { Sandbox } from "@open-harness/sandbox";
import { generateText } from "ai";
import { gateway } from "@open-harness/agent";
import { getGitHubAccount } from "@/lib/db/accounts";
import { buildGitHubAuthRemoteUrl } from "@/lib/github/repo-identifiers";
import { getAppCoAuthorTrailer } from "@/lib/github/app-auth";
import { getUserGitHubToken } from "@/lib/github/user-token";

export interface AutoCommitParams {
  sandbox: Sandbox;
  userId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
}

export interface AutoCommitResult {
  committed: boolean;
  pushed: boolean;
  commitMessage?: string;
  commitSha?: string;
  error?: string;
}

/**
 * Performs an auto-commit directly using the sandbox.
 * Stages all changes, generates a commit message, commits, and pushes.
 */
export async function performAutoCommit(
  params: AutoCommitParams,
): Promise<AutoCommitResult> {
  const { sandbox, userId, sessionTitle, repoOwner, repoName } = params;
  const cwd = sandbox.workingDirectory;

  // 1. Check for uncommitted changes
  const statusResult = await sandbox.exec("git status --porcelain", cwd, 10000);
  if (!statusResult.success || !statusResult.stdout.trim()) {
    return { committed: false, pushed: false };
  }

  // 2. Set up auth on the remote
  const repoToken = await getUserGitHubToken(userId);

  if (repoToken) {
    const authUrl = buildGitHubAuthRemoteUrl({
      token: repoToken,
      owner: repoOwner,
      repo: repoName,
    });

    if (authUrl) {
      await sandbox.exec(`git remote set-url origin "${authUrl}"`, cwd, 10000);
    }
  }

  // 3. Stage all changes
  const addResult = await sandbox.exec("git add -A", cwd, 10000);
  if (!addResult.success) {
    return {
      committed: false,
      pushed: false,
      error: "Failed to stage changes",
    };
  }

  // 4. Generate commit message
  const commitMessage = await generateCommitMessage(sandbox, cwd, sessionTitle);

  // 5. Set git author identity
  const githubAccount = await getGitHubAccount(userId);
  if (githubAccount?.externalUserId && githubAccount.username) {
    const userEmail = `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`;
    await sandbox.exec(
      `git config user.name '${githubAccount.username.replace(/'/g, "'\\''")}'`,
      cwd,
      5000,
    );
    await sandbox.exec(`git config user.email '${userEmail}'`, cwd, 5000);
  }

  // 6. Commit with Co-Authored-By trailer for the agent app
  const escapedMessage = commitMessage.replace(/'/g, "'\\''");
  const coAuthorTrailer = await getAppCoAuthorTrailer();
  const trailerArg = coAuthorTrailer
    ? ` -m '${coAuthorTrailer.replace(/'/g, "'\\''")}'`
    : "";
  const commitResult = await sandbox.exec(
    `git commit -m '${escapedMessage}'${trailerArg}`,
    cwd,
    10000,
  );

  if (!commitResult.success) {
    return {
      committed: false,
      pushed: false,
      error: `Failed to commit: ${commitResult.stdout}`,
    };
  }

  const headResult = await sandbox.exec("git rev-parse HEAD", cwd, 5000);
  const commitSha = headResult.stdout.trim() || undefined;

  // 7. Push
  const branchResult = await sandbox.exec(
    "git symbolic-ref --short HEAD",
    cwd,
    5000,
  );
  const currentBranch = branchResult.stdout.trim() || "HEAD";

  const pushResult = await sandbox.exec(
    `GIT_TERMINAL_PROMPT=0 git push -u origin ${currentBranch}`,
    cwd,
    60000,
  );

  if (!pushResult.success) {
    console.warn(`[auto-commit] Push failed for session ${params.sessionId}`);
    return {
      committed: true,
      pushed: false,
      commitMessage,
      commitSha,
      error: "Commit succeeded but push failed",
    };
  }

  console.log(
    `[auto-commit] Successfully committed and pushed for session ${params.sessionId}`,
  );

  return {
    committed: true,
    pushed: true,
    commitMessage,
    commitSha,
  };
}

async function generateCommitMessage(
  sandbox: Sandbox,
  cwd: string,
  sessionTitle: string,
): Promise<string> {
  const fallback = "chore: update repository changes";

  try {
    const stagedDiffResult = await sandbox.exec(
      "git diff --cached",
      cwd,
      30000,
    );
    const diffForCommit = stagedDiffResult.stdout;

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
