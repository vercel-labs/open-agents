import { connectVercelSandbox } from "@open-harness/sandbox";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";

interface CreateSnapshotRequest {
  sandboxId: string;
  taskId: string;
}

interface RestoreSnapshotRequest {
  sandboxId: string;
  taskId: string;
}

/**
 * POST - Create a snapshot of the sandbox filesystem
 */
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return Response.json(
      { error: "BLOB_READ_WRITE_TOKEN not configured" },
      { status: 500 },
    );
  }

  let body: CreateSnapshotRequest;
  try {
    body = (await req.json()) as CreateSnapshotRequest;
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

    if (!sandbox.snapshot) {
      return Response.json(
        { error: "Snapshot not supported by this sandbox type" },
        { status: 400 },
      );
    }

    // Generate a scoped, short-lived client token for the upload
    // This is safer than passing the full BLOB_READ_WRITE_TOKEN to the sandbox
    const pathname = `snapshots/${taskId}/${Date.now()}.tgz`;
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: blobToken,
      pathname,
      allowedContentTypes: ["application/gzip", "application/x-gzip"],
      maximumSizeInBytes: 500 * 1024 * 1024, // 500MB max
      validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    const result = await sandbox.snapshot({
      blobToken: clientToken,
      pathname,
    });

    // Update task with snapshot info
    await updateTask(taskId, {
      snapshotUrl: result.downloadUrl,
      snapshotCreatedAt: new Date(),
    });

    return Response.json({
      url: result.url,
      downloadUrl: result.downloadUrl,
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
 * PUT - Restore a snapshot to the sandbox filesystem
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

  const { sandboxId, taskId } = body;

  if (!sandboxId || !taskId) {
    return Response.json(
      { error: "Missing sandboxId or taskId" },
      { status: 400 },
    );
  }

  // Verify task ownership and get snapshot URL
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
  if (!task.snapshotUrl) {
    return Response.json(
      { error: "No snapshot available for this task" },
      { status: 404 },
    );
  }

  try {
    const sandbox = await connectVercelSandbox({ sandboxId });

    if (!sandbox.restoreSnapshot) {
      return Response.json(
        { error: "Restore not supported by this sandbox type" },
        { status: 400 },
      );
    }

    await sandbox.restoreSnapshot({
      downloadUrl: task.snapshotUrl,
      clean: true,
    });

    return Response.json({
      success: true,
      restoredFrom: task.snapshotUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: `Failed to restore snapshot: ${message}` },
      { status: 500 },
    );
  }
}
