import { connectVercelSandbox } from "@open-harness/sandbox";
import { getTaskById } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";

interface GitStatusRequest {
  sandboxId: string;
  taskId: string;
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: GitStatusRequest;
  try {
    body = (await req.json()) as GitStatusRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sandboxId, taskId } = body;

  if (!sandboxId || !taskId) {
    return Response.json(
      { error: "sandboxId and taskId are required" },
      { status: 400 },
    );
  }

  // Verify task ownership
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (task.sandboxId !== sandboxId) {
    return Response.json(
      { error: "Sandbox does not belong to this task" },
      { status: 403 },
    );
  }

  try {
    const sandbox = await connectVercelSandbox({ sandboxId });
    const cwd = sandbox.workingDirectory;

    // Get current branch - detect detached HEAD explicitly
    const symbolicRefResult = await sandbox.exec(
      "git symbolic-ref --short HEAD",
      cwd,
      10000,
    );

    let branch: string;
    let isDetachedHead = false;

    if (symbolicRefResult.success && symbolicRefResult.stdout.trim()) {
      branch = symbolicRefResult.stdout.trim();
    } else {
      // Detached HEAD - get short commit hash for display
      const revParseResult = await sandbox.exec(
        "git rev-parse --short HEAD",
        cwd,
        10000,
      );
      branch = revParseResult.stdout.trim();
      isDetachedHead = true;
    }

    // Check for uncommitted changes
    const statusResult = await sandbox.exec(
      "git status --porcelain",
      cwd,
      10000,
    );
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    // Count uncommitted files
    const uncommittedFiles = statusResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0).length;

    return Response.json({
      branch,
      isDetachedHead,
      hasUncommittedChanges,
      uncommittedFiles: hasUncommittedChanges ? uncommittedFiles : 0,
    });
  } catch (error) {
    console.error("Failed to get git status:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
