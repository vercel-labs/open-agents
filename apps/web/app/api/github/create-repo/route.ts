import { connectVercelSandbox } from "@open-harness/sandbox";
import { generateText, gateway } from "ai";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";
import { createRepository } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";

// Allow up to 2 minutes for git operations
export const maxDuration = 120;

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
      return Response.json(
        { error: "Failed to initialize git repository" },
        { status: 500 },
      );
    }
  }

  // 9. Configure git user (in case not already configured)
  await sandbox.exec(
    `git config user.name "${session.user.name ?? session.user.username}"`,
    cwd,
    5000,
  );
  await sandbox.exec(
    `git config user.email "${session.user.email ?? `${session.user.username}@users.noreply.github.com`}"`,
    cwd,
    5000,
  );

  // 10. Add remote origin with authentication
  // First remove existing origin if any
  await sandbox.exec("git remote remove origin 2>/dev/null || true", cwd, 5000);

  // Add origin with token for auth
  const authUrl = repoResult.cloneUrl?.replace(
    "https://",
    `https://${githubToken}@`,
  );
  const addRemoteResult = await sandbox.exec(
    `git remote add origin ${authUrl}`,
    cwd,
    5000,
  );
  if (!addRemoteResult.success) {
    return Response.json(
      { error: "Failed to add remote origin" },
      { status: 500 },
    );
  }

  // 11. Stage all files
  const addResult = await sandbox.exec("git add -A", cwd, 10000);
  if (!addResult.success) {
    return Response.json({ error: "Failed to stage files" }, { status: 500 });
  }

  // 12. Generate commit message with AI
  const diffResult = await sandbox.exec("git diff --cached --stat", cwd, 30000);
  let commitMessage = "Initial commit";

  try {
    const commitMsgResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for an initial commit of a new project. Use conventional commit format. One line only, max 72 characters.

Task context: ${taskTitle}

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
    return Response.json(
      { error: `Failed to commit: ${commitResult.stdout}` },
      { status: 500 },
    );
  }

  // 14. Rename branch to main if needed
  await sandbox.exec("git branch -M main", cwd, 5000);

  // 15. Push to remote
  const pushResult = await sandbox.exec("git push -u origin main", cwd, 60000);
  if (!pushResult.success) {
    const pushOutput = pushResult.stdout + (pushResult.stderr ?? "");
    return Response.json(
      { error: `Failed to push: ${pushOutput.slice(0, 200)}` },
      { status: 500 },
    );
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
