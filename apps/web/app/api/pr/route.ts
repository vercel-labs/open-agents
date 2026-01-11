import { createPullRequest } from "@/lib/github/client";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreatePRRequest {
  taskId: string;
  repoUrl: string;
  branchName: string;
  title: string;
  body?: string;
  baseBranch: string;
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse and validate request
  let body: CreatePRRequest;
  try {
    body = (await req.json()) as CreatePRRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId, repoUrl, branchName, title, body: prBody, baseBranch } = body;

  if (!taskId || !repoUrl || !branchName || !title || !baseBranch) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 3. Verify task ownership
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // 4. Create PR using existing function
  const result = await createPullRequest({
    repoUrl,
    branchName,
    title,
    body: prBody || "",
    baseBranch,
  });

  if (!result.success) {
    const error = result.error || "Failed to create pull request";

    // Determine appropriate status code based on error type
    // Client errors (400): invalid input, PR already exists
    // Server errors (502): GitHub API failures, network issues
    const isClientError =
      error.includes("Invalid") ||
      error.includes("already exists") ||
      error.includes("not found") ||
      error.includes("not connected");

    return Response.json({ error }, { status: isClientError ? 400 : 502 });
  }

  // 5. Update task with PR info
  await updateTask(taskId, {
    prNumber: result.prNumber,
    prStatus: "open",
  });

  // 6. Return success
  return Response.json({
    success: true,
    prUrl: result.prUrl,
    prNumber: result.prNumber,
  });
}
