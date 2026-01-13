import { connectVercelSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById } from "@/lib/db/tasks";

const EXTEND_DURATION = 300_000; // 5 minutes

interface ExtendRequest {
  sandboxId: string;
  taskId: string;
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: ExtendRequest;
  try {
    body = (await req.json()) as ExtendRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sandboxId, taskId } = body;

  if (!sandboxId || !taskId) {
    return Response.json(
      { error: "Missing sandboxId or taskId" },
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
    const result = await sandbox.extendTimeout(EXTEND_DURATION);

    return Response.json({
      success: true,
      expiresAt: result.expiresAt,
      extendedBy: EXTEND_DURATION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
