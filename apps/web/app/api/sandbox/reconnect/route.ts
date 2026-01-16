import { connectSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";

export type ReconnectStatus =
  | "connected"
  | "expired"
  | "not_found"
  | "no_sandbox";

export type ReconnectResponse = {
  status: ReconnectStatus;
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

  // No sandbox state at all
  if (!task.sandboxState) {
    return Response.json({
      status: "no_sandbox",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  const state = task.sandboxState;

  // Pre-handoff hybrid (has files) - always available since JustBash is in-memory
  if (state.type === "hybrid" && state.files) {
    return Response.json({
      status: "connected",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  // Post-handoff hybrid or Vercel - has sandboxId, try to connect
  try {
    await connectSandbox(state);
    return Response.json({
      status: "connected",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  } catch {
    // Sandbox no longer exists (expired or stopped)
    await updateTask(taskId, { sandboxState: null });
    return Response.json({
      status: "expired",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }
}
