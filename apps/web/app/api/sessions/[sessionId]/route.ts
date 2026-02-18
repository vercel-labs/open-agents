import { connectSandbox } from "@open-harness/sandbox";
import { after } from "next/server";
import {
  deleteSession,
  getSessionById,
  updateSession,
} from "@/lib/db/sessions";
import { canOperateOnSandbox, clearSandboxState } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

interface UpdateSessionRequest {
  title?: string;
  status?: "running" | "completed" | "failed" | "archived";
  linesAdded?: number;
  linesRemoved?: number;
  prNumber?: number;
  prStatus?: "open" | "merged" | "closed";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ session: existingSession });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpdateSessionRequest;
  try {
    body = (await req.json()) as UpdateSessionRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shouldStopSandboxAfterArchive =
    body.status === "archived" && existingSession.status !== "archived";

  const shouldUnarchive =
    body.status === "running" && existingSession.status === "archived";

  const updatePayload: UpdateSessionRequest &
    Partial<{
      lifecycleState: "archived" | null;
      lifecycleError: null;
      sandboxExpiresAt: null;
      hibernateAfter: null;
    }> = { ...body };
  if (shouldStopSandboxAfterArchive) {
    updatePayload.lifecycleState = "archived";
    updatePayload.sandboxExpiresAt = null;
    updatePayload.hibernateAfter = null;
  }
  if (shouldUnarchive) {
    // Reset lifecycle state so the session can be resumed normally.
    // If there is a snapshot the client will auto-restore it on entry.
    updatePayload.lifecycleState = null;
    updatePayload.lifecycleError = null;
  }

  const updatedSession = await updateSession(sessionId, updatePayload);
  if (!updatedSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (shouldStopSandboxAfterArchive) {
    after(async () => {
      try {
        const archivedSession = await getSessionById(sessionId);
        if (!archivedSession || archivedSession.status !== "archived") {
          return;
        }
        if (!canOperateOnSandbox(archivedSession.sandboxState)) {
          return;
        }

        const sandbox = await connectSandbox(archivedSession.sandboxState);
        await sandbox.stop();

        await updateSession(sessionId, {
          sandboxState: clearSandboxState(archivedSession.sandboxState),
          lifecycleState: "archived",
          sandboxExpiresAt: null,
          hibernateAfter: null,
          lifecycleError: null,
        });
      } catch (error) {
        console.error(
          `[Sessions] Failed to stop sandbox for archived session ${sessionId}:`,
          error,
        );
      }
    });
  }

  return Response.json({ session: updatedSession });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await deleteSession(sessionId);
  return Response.json({ success: true });
}
