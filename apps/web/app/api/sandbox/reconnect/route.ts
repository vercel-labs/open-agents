import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { clearSandboxState, isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type ReconnectStatus =
  | "connected"
  | "expired"
  | "not_found"
  | "no_sandbox";

export type ReconnectResponse = {
  status: ReconnectStatus;
  hasSnapshot: boolean;
  /** Timestamp (ms) when sandbox expires. Only present when status is "connected". */
  expiresAt?: number;
};

export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // No active sandbox
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({
      status: "no_sandbox",
      hasSnapshot: !!sessionRecord.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  const state = sessionRecord.sandboxState;

  // Pre-handoff hybrid (has files) - always available since JustBash is in-memory
  // No expiresAt for pre-handoff since JustBash doesn't timeout
  if (state.type === "hybrid" && state.files && !state.sandboxId) {
    return Response.json({
      status: "connected",
      hasSnapshot: !!sessionRecord.snapshotUrl,
    } satisfies ReconnectResponse);
  }

  // Post-handoff hybrid or Vercel - has sandboxId, try to connect
  try {
    const sandbox = await connectSandbox(state);
    return Response.json({
      status: "connected",
      hasSnapshot: !!sessionRecord.snapshotUrl,
      expiresAt: sandbox.expiresAt,
    } satisfies ReconnectResponse);
  } catch {
    // Sandbox no longer exists (expired or stopped)
    await updateSession(sessionId, {
      sandboxState: clearSandboxState(sessionRecord.sandboxState),
    });
    return Response.json({
      status: "expired",
      hasSnapshot: !!sessionRecord.snapshotUrl,
    } satisfies ReconnectResponse);
  }
}
