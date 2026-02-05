import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { EXTEND_TIMEOUT_DURATION_MS } from "@/lib/sandbox/config";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

interface ExtendRequest {
  sessionId: string;
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
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sessionRecord.sandboxState);
    if (!sandbox.extendTimeout) {
      return Response.json(
        { error: "Extend timeout not supported by this sandbox type" },
        { status: 400 },
      );
    }
    const result = await sandbox.extendTimeout(EXTEND_TIMEOUT_DURATION_MS);

    // Persist updated expiresAt to database
    if (typeof sandbox.getState === "function") {
      const newState = sandbox.getState();
      if (newState) {
        await updateSession(sessionId, {
          sandboxState: newState as SandboxState,
        });
      }
    }

    return Response.json({
      success: true,
      expiresAt: result.expiresAt,
      extendedBy: EXTEND_TIMEOUT_DURATION_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
