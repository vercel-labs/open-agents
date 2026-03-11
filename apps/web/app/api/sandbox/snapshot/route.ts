import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  buildHibernatedLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  canOperateOnSandbox,
  clearSandboxState,
  hasRuntimeSandboxState,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreateSnapshotRequest {
  sessionId: string;
}

interface RestoreSnapshotRequest {
  sessionId: string;
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

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sessionRecord.sandboxState);

    if (!sandbox.snapshot) {
      return Response.json(
        { error: "Snapshot not supported by this sandbox type" },
        { status: 400 },
      );
    }

    // Create snapshot (automatically stops the sandbox)
    const result = await sandbox.snapshot();

    // Update session with snapshot info (now stores snapshotId instead of downloadUrl)
    // Also clear sandbox state but preserve the type for future restoration
    const clearedState = clearSandboxState(sessionRecord.sandboxState);

    await updateSession(sessionId, {
      snapshotUrl: result.snapshotId,
      snapshotCreatedAt: new Date(),
      sandboxState: clearedState,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildHibernatedLifecycleUpdate(),
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

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Verify session ownership and get snapshot URL
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // TODO: If the background after() callback in the archive flow crashes before
  // reaching updateSession (e.g. connectSandbox or sandbox.snapshot() throws),
  // sandboxState retains runtime data and snapshotUrl stays null. This leaves
  // the session permanently returning 409 with no self-service recovery path.
  if (!sessionRecord.snapshotUrl) {
    if (hasRuntimeSandboxState(sessionRecord.sandboxState)) {
      console.warn(
        `[Snapshot Restore] session=${sessionId} pending=true sandboxType=${sessionRecord.sandboxState?.type ?? "null"}`,
      );
      return Response.json(
        {
          error:
            "Snapshot is still being created. Please wait a few seconds and try again.",
        },
        { status: 409 },
      );
    }

    console.error(
      `[Snapshot Restore] session=${sessionId} error=no_snapshot sandboxType=${sessionRecord.sandboxState?.type ?? "null"}`,
    );
    return Response.json(
      { error: "No snapshot available for this session" },
      { status: 404 },
    );
  }
  if (!sessionRecord.sandboxState) {
    console.error(
      `[Snapshot Restore] session=${sessionId} error=no_sandbox_state hasSnapshot=true`,
    );
    return Response.json(
      { error: "No sandbox state available for restoration" },
      { status: 400 },
    );
  }
  if (sessionRecord.sandboxState.type !== "vercel") {
    return Response.json(
      { error: "Snapshot restoration is only supported for Vercel sandboxes" },
      { status: 400 },
    );
  }
  const sandboxType = sessionRecord.sandboxState.type;
  // Warn if sandbox appears to still be running (has sandboxId)
  // This shouldn't happen in normal flow since snapshot stops the sandbox
  if (canOperateOnSandbox(sessionRecord.sandboxState)) {
    console.log(
      `[Snapshot Restore] session=${sessionId} already_running=true sandboxType=${sandboxType}`,
    );
    return Response.json({
      success: true,
      alreadyRunning: true,
      restoredFrom: sessionRecord.snapshotUrl,
    });
  }

  try {
    // Restore sandbox from snapshot - only pass type and snapshotId
    // Do NOT spread full sandboxState as it may contain a stale sandboxId
    // which would cause connectSandbox to reconnect instead of restore
    const sandbox = await connectSandbox(
      { type: sandboxType, snapshotId: sessionRecord.snapshotUrl },
      {
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        ports: DEFAULT_SANDBOX_PORTS,
      },
    );

    // Update session with new sandbox state
    const newState = sandbox.getState?.();
    const restoredState = (newState ?? {
      type: sandboxType,
      snapshotId: sessionRecord.snapshotUrl,
    }) as Parameters<typeof updateSession>[1]["sandboxState"];

    await updateSession(sessionId, {
      sandboxState: restoredState,
      lifecycleVersion: getNextLifecycleVersion(sessionRecord.lifecycleVersion),
      ...buildActiveLifecycleUpdate(restoredState),
    });

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "snapshot-restored",
    });

    console.log(
      `[Snapshot Restore] session=${sessionId} success=true sandboxType=${sandboxType} sandboxId=${"id" in sandbox ? sandbox.id : "n/a"} restoredFrom=${sessionRecord.snapshotUrl}`,
    );

    return Response.json({
      success: true,
      restoredFrom: sessionRecord.snapshotUrl,
      sandboxId: "id" in sandbox ? sandbox.id : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[Snapshot Restore] session=${sessionId} success=false error=${message}`,
    );
    return Response.json(
      { error: `Failed to restore snapshot: ${message}` },
      { status: 500 },
    );
  }
}
