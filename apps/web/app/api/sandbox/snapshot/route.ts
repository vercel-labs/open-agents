import { connectSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";

interface CreateSnapshotRequest {
  taskId: string;
}

interface RestoreSnapshotRequest {
  taskId: string;
}

/**
 * POST - Create a native Vercel snapshot of the sandbox filesystem.
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
  if (!task.sandboxState) {
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

    // Create native Vercel snapshot (automatically stops the sandbox)
    const result = await sandbox.snapshot();

    // Update task with snapshot info (now stores snapshotId instead of downloadUrl)
    await updateTask(taskId, {
      snapshotUrl: result.snapshotId,
      snapshotCreatedAt: new Date(),
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

  try {
    // Create a new sandbox from the snapshot
    const sandbox = await connectSandbox({
      type: "vercel",
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
