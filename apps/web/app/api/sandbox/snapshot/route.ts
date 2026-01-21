import { connectSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { clearSandboxState, canOperateOnSandbox } from "@/lib/sandbox/utils";

interface CreateSnapshotRequest {
  taskId: string;
}

interface RestoreSnapshotRequest {
  taskId: string;
}

/**
 * POST - Create a snapshot of the sandbox filesystem.
 * IMPORTANT: This automatically stops the sandbox after snapshot creation.
 */
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CreateSnapshotRequest;
  try {
    body = (await req.json()) as CreateSnapshotRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId } = body;

  if (!taskId) {
    return Response.json({ error: "Missing taskId" }, { status: 400 });
  }

  // Verify task ownership
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canOperateOnSandbox(task.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(task.sandboxState);

    if (!sandbox.snapshot) {
      return Response.json(
        { error: "Snapshot not supported by this sandbox type" },
        { status: 400 },
      );
    }

    // Create snapshot (automatically stops the sandbox)
    const result = await sandbox.snapshot();

    // Update task with snapshot info (now stores snapshotId instead of downloadUrl)
    // Also clear sandbox state but preserve the type for future restoration
    const clearedState = clearSandboxState(task.sandboxState);

    await updateTask(taskId, {
      snapshotUrl: result.snapshotId,
      snapshotCreatedAt: new Date(),
      sandboxState: clearedState,
    });

    return Response.json({
      snapshotId: result.snapshotId,
      createdAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: `Failed to create snapshot: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * PUT - Restore a snapshot by creating a new sandbox from it.
 */
export async function PUT(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: RestoreSnapshotRequest;
  try {
    body = (await req.json()) as RestoreSnapshotRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId } = body;

  if (!taskId) {
    return Response.json({ error: "Missing taskId" }, { status: 400 });
  }

  // Verify task ownership and get snapshot URL
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!task.snapshotUrl) {
    return Response.json(
      { error: "No snapshot available for this task" },
      { status: 404 },
    );
  }
  if (!task.sandboxState) {
    return Response.json(
      { error: "No sandbox state available for restoration" },
      { status: 400 },
    );
  }
  if (task.sandboxState.type === "just-bash") {
    return Response.json(
      { error: "Snapshot restoration not supported for just-bash sandboxes" },
      { status: 400 },
    );
  }

  try {
    // Restore sandbox from snapshot by adding snapshotId to existing state
    const sandbox = await connectSandbox({
      ...task.sandboxState,
      snapshotId: task.snapshotUrl,
    });

    // Update task with new sandbox state
    const newState = sandbox.getState?.();
    if (newState) {
      await updateTask(taskId, {
        sandboxState: newState as Parameters<
          typeof updateTask
        >[1]["sandboxState"],
      });
    }

    return Response.json({
      success: true,
      restoredFrom: task.snapshotUrl,
      sandboxId: "id" in sandbox ? sandbox.id : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: `Failed to restore snapshot: ${message}` },
      { status: 500 },
    );
  }
}
