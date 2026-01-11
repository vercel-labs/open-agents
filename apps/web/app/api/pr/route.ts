import { createPullRequest } from "@/lib/github/client";
import { updateTask } from "@/lib/db/tasks";
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

  // 3. Create PR using existing function
  const result = await createPullRequest({
    repoUrl,
    branchName,
    title,
    body: prBody || "",
    baseBranch,
  });

  if (!result.success) {
    return Response.json(
      { error: result.error || "Failed to create pull request" },
      { status: 400 },
    );
  }

  // 4. Update task with PR info
  await updateTask(taskId, {
    prNumber: result.prNumber,
    prStatus: "open",
  });

  // 5. Return success
  return Response.json({
    success: true,
    prUrl: result.prUrl,
    prNumber: result.prNumber,
  });
}
