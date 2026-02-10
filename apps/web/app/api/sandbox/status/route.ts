import { after } from "next/server";
import { getSessionById } from "@/lib/db/sessions";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { hasRuntimeSandboxState } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type SandboxStatusResponse = {
  status: "active" | "no_sandbox";
  hasSnapshot: boolean;
  lifecycleVersion: number;
  lifecycle: {
    serverTime: number;
    state: string | null;
    lastActivityAt: number | null;
    hibernateAfter: number | null;
    sandboxExpiresAt: number | null;
  };
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

  const hasRuntimeState = hasRuntimeSandboxState(sessionRecord.sandboxState);

  // Check expiry: the DB may still have sandboxId/files but the VM has expired.
  // Use the same 10s buffer as the chat route's isSandboxActive() so they agree.
  let isExpired = false;
  if (hasRuntimeState && sessionRecord.sandboxExpiresAt) {
    isExpired = Date.now() >= sessionRecord.sandboxExpiresAt.getTime() - 10_000;
  }

  const isActive = hasRuntimeState && !isExpired;

  // Safety net: if the sandbox has stale runtime state (expired or overdue for
  // hibernation), kick the lifecycle to clean up DB state in the background.
  if (
    hasRuntimeState &&
    sessionRecord.lifecycleState === "active" &&
    sessionRecord.hibernateAfter
  ) {
    const now = Date.now();
    const hibernateAfterMs = sessionRecord.hibernateAfter.getTime();
    if (isExpired || now >= hibernateAfterMs) {
      after(() =>
        kickSandboxLifecycleWorkflow({
          sessionId: sessionRecord.id,
          reason: "status-check-overdue",
        }),
      );
    }
  }

  return Response.json({
    status: isActive ? "active" : "no_sandbox",
    hasSnapshot: !!sessionRecord.snapshotUrl,
    lifecycleVersion: sessionRecord.lifecycleVersion,
    lifecycle: {
      serverTime: Date.now(),
      state: sessionRecord.lifecycleState,
      lastActivityAt: sessionRecord.lastActivityAt?.getTime() ?? null,
      hibernateAfter: sessionRecord.hibernateAfter?.getTime() ?? null,
      sandboxExpiresAt: sessionRecord.sandboxExpiresAt?.getTime() ?? null,
    },
  } satisfies SandboxStatusResponse);
}
