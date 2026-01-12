import { connectVercelSandbox } from "@open-harness/sandbox";
import { generateText, gateway, NoObjectGeneratedError, Output } from "ai";
import { getTaskById } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";
import { z } from "zod";

const prContentSchema = z.object({
  title: z.string().describe("A concise PR title, max 72 characters"),
  body: z
    .string()
    .describe(
      "A markdown PR body with: brief summary of changes, list of key changes as bullet points, and notes for reviewers if applicable",
    ),
});

// Allow up to 2 minutes for AI generation and git operations
export const maxDuration = 120;

interface GeneratePRRequest {
  taskId: string;
  sandboxId: string;
  taskTitle: string;
  baseBranch: string;
  branchName: string;
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse request
  let body: GeneratePRRequest;
  try {
    body = (await req.json()) as GeneratePRRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId, sandboxId, taskTitle, baseBranch, branchName } = body;

  if (!taskId) {
    return Response.json({ error: "Task ID is required" }, { status: 400 });
  }

  // Verify task ownership
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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

  if (!branchName) {
    return Response.json({ error: "Branch name is required" }, { status: 400 });
  }

  if (!baseBranch) {
    return Response.json({ error: "Base branch is required" }, { status: 400 });
  }

  // Validate baseBranch to prevent command injection
  const safeBranchPattern = /^[\w\-/.]+$/;
  if (!safeBranchPattern.test(baseBranch)) {
    return Response.json(
      { error: "Invalid base branch name" },
      { status: 400 },
    );
  }

  if (!safeBranchPattern.test(branchName)) {
    return Response.json({ error: "Invalid branch name" }, { status: 400 });
  }

  // 3. Connect to sandbox
  const sandbox = await connectVercelSandbox({ sandboxId });
  const cwd = sandbox.workingDirectory;

  const gitActions: {
    committed?: boolean;
    commitMessage?: string;
    pushed?: boolean;
  } = {};

  // 4. Check for uncommitted changes
  const statusResult = await sandbox.exec("git status --porcelain", cwd, 10000);
  const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

  if (hasUncommittedChanges) {
    // 4a. Get diff for commit message generation
    const diffResult = await sandbox.exec("git diff HEAD", cwd, 30000);
    const stagedDiffResult = await sandbox.exec(
      "git diff --cached",
      cwd,
      30000,
    );
    const diffForCommit = diffResult.stdout + stagedDiffResult.stdout;

    // 4b. Stage all changes
    const addResult = await sandbox.exec("git add -A", cwd, 10000);
    if (!addResult.success) {
      return Response.json(
        { error: "Failed to stage changes" },
        { status: 500 },
      );
    }

    // 4c. Generate commit message with AI
    const commitMsgResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Task context: ${taskTitle}

Diff:
${diffForCommit.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
    });

    const commitMessage = commitMsgResult.text.trim();

    // 4d. Create commit (escape shell special characters in message)
    // Using single quotes is safest, but we need to handle single quotes in the message
    // by ending the quote, adding an escaped single quote, and starting a new quote
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

    gitActions.committed = true;
    gitActions.commitMessage = commitMessage;
  }

  // 5. Check if branch needs to be pushed
  const trackingResult = await sandbox.exec(
    "git rev-list @{upstream}..HEAD 2>/dev/null || echo 'needs-push'",
    cwd,
    10000,
  );

  const needsPush =
    trackingResult.stdout.includes("needs-push") ||
    trackingResult.stdout.trim().length > 0;

  if (needsPush) {
    // 5a. Push branch
    const pushResult = await sandbox.exec(
      `git push -u origin ${branchName}`,
      cwd,
      60000,
    );

    if (!pushResult.success) {
      return Response.json(
        {
          error: `Failed to push: ${pushResult.stdout}. You may need to resolve conflicts manually.`,
        },
        { status: 500 },
      );
    }

    gitActions.pushed = true;
  }

  // 6. Get diff stats for PR generation
  const diffStatsResult = await sandbox.exec(
    `git diff ${baseBranch}...HEAD --stat`,
    cwd,
    30000,
  );

  const commitLogResult = await sandbox.exec(
    `git log ${baseBranch}..HEAD --oneline`,
    cwd,
    10000,
  );

  // 7. Check if there are changes to PR
  if (!diffStatsResult.stdout.trim() && !commitLogResult.stdout.trim()) {
    return Response.json(
      {
        error: `No changes found compared to ${baseBranch}. Nothing to create a PR for.`,
      },
      { status: 400 },
    );
  }

  // 8. Generate PR title and body with AI using structured output
  let prContent: z.infer<typeof prContentSchema>;
  try {
    const { output } = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      output: Output.object({
        schema: prContentSchema,
      }),
      prompt: `Generate a pull request title and body for these changes.

Task: ${taskTitle}
Branch: ${branchName} -> ${baseBranch}

Changes summary:
${diffStatsResult.stdout}

Commits:
${commitLogResult.stdout}`,
    });

    // Handle case where output is undefined (model failed to generate valid object)
    if (!output) {
      prContent = {
        title: taskTitle,
        body: `## Changes\n\n${diffStatsResult.stdout}\n\n## Commits\n\n${commitLogResult.stdout}`,
      };
    } else {
      prContent = output;
    }
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // Fallback if structured output generation fails
      prContent = {
        title: taskTitle,
        body: `## Changes\n\n${diffStatsResult.stdout}\n\n## Commits\n\n${commitLogResult.stdout}`,
      };
    } else {
      throw error;
    }
  }

  // 10. Return response
  return Response.json({
    title: prContent.title,
    body: prContent.body,
    ...(Object.keys(gitActions).length > 0 && { gitActions }),
  });
}
