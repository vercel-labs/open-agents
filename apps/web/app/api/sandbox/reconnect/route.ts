import { connectSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";

export type ReconnectStatus =
  | "connected"
  | "expired"
  | "not_found"
  | "no_sandbox";

export type ReconnectResponse =
  | {
      status: "connected";
      hasSnapshot: boolean;
    }
  | {
      status: "expired" | "not_found" | "no_sandbox";
      hasSnapshot: boolean;
    };

export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");

  if (!taskId) {
    return Response.json({ error: "Missing taskId" }, { status: 400 });
  }

  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // No sandbox to reconnect to
  if (!task.sandboxState) {
    return Response.json({
      status: "no_sandbox",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  // Attempt to connect using the unified API
  try {
    await connectSandbox(task.sandboxState);

    return Response.json({
      status: "connected",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  } catch {
    // Sandbox no longer exists (was stopped or timed out)
    // Clear sandbox state from task
    await updateTask(taskId, {
      sandboxState: null,
    });

    return Response.json({
      status: "not_found",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }
}
