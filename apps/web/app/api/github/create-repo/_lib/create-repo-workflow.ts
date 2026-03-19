import type { Sandbox } from "@open-harness/sandbox";
import { gateway, generateText } from "ai";
import { getGitHubAccount } from "@/lib/db/accounts";
import { createRepository } from "@/lib/github/client";

// Escape shell metacharacters to prevent command injection
const escapeShellArg = (arg: string) => `'${arg.replace(/'/g, "'\\''")}'`;

type SessionUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
};

type WorkflowResult =
  | { ok: false; response: Response }
  | {
      ok: true;
      repoUrl: string | undefined;
      cloneUrl: string;
      owner: string;
      repoName: string;
      branch: "main";
    };

interface RunCreateRepoWorkflowParams {
  sandbox: Pick<Sandbox, "exec">;
  cwd: string;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  sessionTitle: string;
  owner?: string;
  accountType?: "User" | "Organization";
  repoToken: string;
  installationToken: string | null;
  sessionUser: SessionUser;
}

export async function runCreateRepoWorkflow({
  sandbox,
  cwd,
  repoName,
  description,
  isPrivate,
  sessionTitle,
  owner,
  accountType,
  repoToken,
  installationToken,
  sessionUser,
}: RunCreateRepoWorkflowParams): Promise<WorkflowResult> {
  // 6. Check if there are any files to push
  const filesResult = await sandbox.exec("ls -A", cwd, 10000);
  if (!filesResult.success || !filesResult.stdout.trim()) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            "No files in sandbox. Create some files before creating a repository.",
        },
        { status: 400 },
      ),
    };
  }

  // 7. Create GitHub repository
  const repoResult = await createRepository({
    name: repoName,
    description,
    isPrivate,
    token: repoToken,
    owner,
    accountType,
  });

  if (!repoResult.success) {
    return {
      ok: false,
      response: Response.json(
        { error: repoResult.error ?? "Failed to create repository" },
        { status: 400 },
      ),
    };
  }

  // Ensure we have required fields from repo creation
  if (!repoResult.cloneUrl || !repoResult.owner || !repoResult.repoName) {
    return {
      ok: false,
      response: Response.json(
        { error: "Repository created but missing required fields" },
        { status: 500 },
      ),
    };
  }

  // Helper to create error response with context about created repo
  const repoCreatedError = (message: string) =>
    Response.json(
      {
        error: `${message}. Note: Repository "${repoResult.owner}/${repoResult.repoName}" was created on GitHub. You may need to delete it manually before retrying.`,
      },
      { status: 500 },
    );

  // 8. Initialize git if not already initialized
  const gitCheckResult = await sandbox.exec(
    "git rev-parse --git-dir",
    cwd,
    5000,
  );
  if (!gitCheckResult.success) {
    // Initialize git
    const initResult = await sandbox.exec("git init", cwd, 10000);
    if (!initResult.success) {
      return {
        ok: false,
        response: repoCreatedError("Failed to initialize git repository"),
      };
    }
  }

  // 9. Configure git user (in case not already configured)
  const githubAccount = await getGitHubAccount(sessionUser.id);
  const githubNoreplyEmail =
    githubAccount?.externalUserId && githubAccount.username
      ? `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`
      : undefined;
  const userName =
    sessionUser.name ?? githubAccount?.username ?? sessionUser.username;
  const userEmail =
    githubNoreplyEmail ??
    sessionUser.email ??
    `${sessionUser.username}@users.noreply.github.com`;

  await sandbox.exec(
    `git config user.name ${escapeShellArg(userName)}`,
    cwd,
    5000,
  );
  await sandbox.exec(
    `git config user.email ${escapeShellArg(userEmail)}`,
    cwd,
    5000,
  );

  // 10. Add remote origin with authentication
  // First remove existing origin if any
  await sandbox.exec("git remote remove origin 2>/dev/null || true", cwd, 5000);

  // Add origin with token for auth
  if (!repoResult.cloneUrl) {
    return {
      ok: false,
      response: Response.json(
        { error: "Repository clone URL is missing" },
        { status: 500 },
      ),
    };
  }

  // For orgs, use installation token for push (has Contents write permission).
  // For personal accounts, use the same OAuth token that created the repo —
  // the installation token may not have access if repositorySelection is "selected".
  const pushToken =
    accountType === "Organization" && installationToken
      ? installationToken
      : repoToken;
  const authUrl = repoResult.cloneUrl.replace(
    "https://",
    `https://x-access-token:${pushToken}@`,
  );
  const addRemoteResult = await sandbox.exec(
    `git remote add origin "${authUrl}"`,
    cwd,
    5000,
  );
  if (!addRemoteResult.success) {
    return {
      ok: false,
      response: repoCreatedError("Failed to add remote origin"),
    };
  }

  // 11. Stage all files
  const addResult = await sandbox.exec("git add -A", cwd, 10000);
  if (!addResult.success) {
    return {
      ok: false,
      response: repoCreatedError("Failed to stage files"),
    };
  }

  // 12. Generate commit message with AI
  const diffResult = await sandbox.exec("git diff --cached --stat", cwd, 30000);
  let commitMessage = "Initial commit";

  // Sanitize sessionTitle to prevent prompt injection and limit length
  const sanitizedSessionTitle = sessionTitle
    .slice(0, 200)
    .replace(/[^\w\s.,!?-]/g, "");

  try {
    const commitMsgResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for an initial commit of a new project. Use conventional commit format. One line only, max 72 characters.

Session context: ${sanitizedSessionTitle}

Files being committed:
${diffResult.stdout.slice(0, 4000)}

Respond with ONLY the commit message, nothing else.`,
    });
    commitMessage = commitMsgResult.text.trim() || "Initial commit";
  } catch {
    // Use fallback message if AI generation fails
    commitMessage = "feat: initial commit";
  }

  // 13. Create commit
  // Do NOT add a Co-Authored-By trailer for the bot — the bot is already
  // attributed as committer when pushing via the installation token, and adding
  // the trailer causes it to appear twice on squash-merged PRs (3 authors).
  const escapedMessage = commitMessage.replace(/'/g, "'\\''");
  const commitResult = await sandbox.exec(
    `git commit -m '${escapedMessage}'`,
    cwd,
    10000,
  );
  if (!commitResult.success) {
    return {
      ok: false,
      response: repoCreatedError(
        `Failed to commit: ${commitResult.stdout.slice(0, 100)}`,
      ),
    };
  }

  // 14. Rename branch to main if needed
  await sandbox.exec("git branch -M main", cwd, 5000);

  // 15. Push to remote
  const pushResult = await sandbox.exec("git push -u origin main", cwd, 60000);
  if (!pushResult.success) {
    const pushOutput = pushResult.stdout + (pushResult.stderr ?? "");
    return {
      ok: false,
      response: repoCreatedError(`Failed to push: ${pushOutput.slice(0, 100)}`),
    };
  }

  return {
    ok: true,
    repoUrl: repoResult.repoUrl,
    cloneUrl: repoResult.cloneUrl,
    owner: repoResult.owner,
    repoName: repoResult.repoName,
    branch: "main",
  };
}
