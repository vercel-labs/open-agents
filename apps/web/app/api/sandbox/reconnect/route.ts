import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
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
      sandboxId: string;
      createdAt: number;
      timeout: number;
      remainingTimeout: number;
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
  if (!task.sandboxId || !task.sandboxCreatedAt || !task.sandboxTimeout) {
    return Response.json({
      status: "no_sandbox",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  // Check if sandbox might still be valid (with 10s buffer)
  const expiresAt = task.sandboxCreatedAt.getTime() + task.sandboxTimeout;
  const now = Date.now();
  const remainingTimeout = expiresAt - now;

  if (remainingTimeout < 10_000) {
    // Clear stale sandbox metadata
    await updateTask(taskId, {
      sandboxId: null,
      sandboxCreatedAt: null,
      sandboxTimeout: null,
    });

    return Response.json({
      status: "expired",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  // Attempt to reconnect
  try {
    await VercelSandboxSDK.get({ sandboxId: task.sandboxId });

    // Success - sandbox exists and is accessible
    return Response.json({
      status: "connected",
      sandboxId: task.sandboxId,
      createdAt: task.sandboxCreatedAt.getTime(),
      timeout: task.sandboxTimeout,
      remainingTimeout,
    } satisfies ReconnectResponse);
  } catch {
    // Sandbox no longer exists (was stopped or timed out on Vercel side)
    // Clear sandbox info from task
    await updateTask(taskId, {
      sandboxId: null,
      sandboxCreatedAt: null,
      sandboxTimeout: null,
    });

    return Response.json({
      status: "not_found",
      hasSnapshot: !!task.snapshotUrl,
    } satisfies ReconnectResponse);
  }
}
