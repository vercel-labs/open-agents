import { connectVercelSandbox } from "@open-harness/sandbox";
import { generateText, gateway } from "ai";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";
import { createRepository } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";

// Allow up to 2 minutes for git operations
export const maxDuration = 120;

// Escape shell metacharacters to prevent command injection
const escapeShellArg = (arg: string) => `'${arg.replace(/'/g, "'\\''")}'`;

interface CreateRepoRequest {
  taskId: string;
  sandboxId: string;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  taskTitle: string;
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse request
  let body: CreateRepoRequest;
  try {
    body = (await req.json()) as CreateRepoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId, sandboxId, repoName, description, isPrivate, taskTitle } =
    body;

  if (!taskId) {
    return Response.json({ error: "Task ID is required" }, { status: 400 });
  }
  if (!repoName) {
    return Response.json(
      { error: "Repository name is required" },
      { status: 400 },
    );
  }

  // 3. Verify task ownership
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Task should not already have a repo
  if (task.cloneUrl) {
    return Response.json(
      { error: "Task already has a repository" },
      { status: 400 },
    );
  }

  if (!sandboxId) {
    return Response.json(
      { error: "Sandbox not active. Please wait for sandbox to start." },
      { status: 400 },
    );
  }
  if (!task.sandboxId) {
    return Response.json(
      { error: "Sandbox not linked to task" },
      { status: 400 },
    );
  }
  if (task.sandboxId !== sandboxId) {
    return Response.json(
      { error: "Sandbox does not belong to this task" },
      { status: 403 },
    );
  }

  // 4. Get GitHub token for git operations
  const githubToken = await getUserGitHubToken();
  if (!githubToken) {
    return Response.json({ error: "GitHub not connected" }, { status: 401 });
  }

  // 5. Connect to sandbox
  const sandbox = await connectVercelSandbox({ sandboxId });
  const cwd = sandbox.workingDirectory;

  // 6. Check if there are any files to push
  const filesResult = await sandbox.exec("ls -A", cwd, 10000);
  if (!filesResult.success || !filesResult.stdout.trim()) {
    return Response.json(
      {
        error:
          "No files in sandbox. Create some files before creating a repository.",
      },
      { status: 400 },
    );
  }

  // 7. Create GitHub repository
  const repoResult = await createRepository({
    name: repoName,
    description,
    isPrivate,
  });

  if (!repoResult.success) {
    return Response.json(
      { error: repoResult.error ?? "Failed to create repository" },
      { status: 400 },
    );
  }

  // Ensure we have required fields from repo creation
  if (!repoResult.cloneUrl || !repoResult.owner || !repoResult.repoName) {
    return Response.json(
      { error: "Repository created but missing required fields" },
      { status: 500 },
    );
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
      return repoCreatedError("Failed to initialize git repository");
    }
  }

  // 9. Configure git user (in case not already configured)
  const userName = session.user.name ?? session.user.username;
  const userEmail =
    session.user.email ?? `${session.user.username}@users.noreply.github.com`;

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
    return Response.json(
      { error: "Repository clone URL is missing" },
      { status: 500 },
    );
  }

  const authUrl = repoResult.cloneUrl.replace(
    "https://",
    `https://${githubToken}@`,
  );
  const addRemoteResult = await sandbox.exec(
    `git remote add origin "${authUrl}"`,
    cwd,
    5000,
  );
  if (!addRemoteResult.success) {
    return repoCreatedError("Failed to add remote origin");
  }

  // 11. Stage all files
  const addResult = await sandbox.exec("git add -A", cwd, 10000);
  if (!addResult.success) {
    return repoCreatedError("Failed to stage files");
  }

  // 12. Generate commit message with AI
  const diffResult = await sandbox.exec("git diff --cached --stat", cwd, 30000);
  let commitMessage = "Initial commit";

  // Sanitize taskTitle to prevent prompt injection and limit length
  const sanitizedTaskTitle = taskTitle
    .slice(0, 200)
    .replace(/[^\w\s.,!?-]/g, "");

  try {
    const commitMsgResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for an initial commit of a new project. Use conventional commit format. One line only, max 72 characters.

Task context: ${sanitizedTaskTitle}

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
  const escapedMessage = commitMessage.replace(/'/g, "'\\''");
  const commitResult = await sandbox.exec(
    `git commit -m '${escapedMessage}'`,
    cwd,
    10000,
  );
  if (!commitResult.success) {
    return repoCreatedError(
      `Failed to commit: ${commitResult.stdout.slice(0, 100)}`,
    );
  }

  // 14. Rename branch to main if needed
  await sandbox.exec("git branch -M main", cwd, 5000);

  // 15. Push to remote
  const pushResult = await sandbox.exec("git push -u origin main", cwd, 60000);
  if (!pushResult.success) {
    const pushOutput = pushResult.stdout + (pushResult.stderr ?? "");
    return repoCreatedError(`Failed to push: ${pushOutput.slice(0, 100)}`);
  }

  // 16. Update task with new repo info
  await updateTask(taskId, {
    repoOwner: repoResult.owner,
    repoName: repoResult.repoName,
    cloneUrl: `https://github.com/${repoResult.owner}/${repoResult.repoName}`,
    branch: "main",
    isNewBranch: false,
  });

  // 17. Return success response
  return Response.json({
    success: true,
    repoUrl: repoResult.repoUrl,
    cloneUrl: repoResult.cloneUrl,
    owner: repoResult.owner,
    repoName: repoResult.repoName,
    branch: "main",
  });
}
