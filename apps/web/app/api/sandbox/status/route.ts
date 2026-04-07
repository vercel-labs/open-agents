import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { SANDBOX_EXPIRES_BUFFER_MS } from "@/lib/sandbox/config";
import {
  getLifecycleDueAtMs,
  getSandboxExpiresAtDate,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  hasPausedSandboxState,
  hasRuntimeSandboxState,
} from "@/lib/sandbox/utils";

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
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  let effectiveSessionRecord = sessionRecord;
  const hasRuntimeState = hasRuntimeSandboxState(sessionRecord.sandboxState);
  const hasPausedState =
    !hasRuntimeState &&
    (hasPausedSandboxState(sessionRecord.sandboxState) ||
      !!sessionRecord.snapshotUrl);

  // Check expiry: the DB may still have sandbox runtime metadata even though the
  // current session has already expired. Use the same 10s buffer as the chat
  // route's isSandboxActive() so they agree.
  let isExpired = false;
  if (hasRuntimeState && sessionRecord.sandboxExpiresAt) {
    isExpired =
      Date.now() >=
      sessionRecord.sandboxExpiresAt.getTime() - SANDBOX_EXPIRES_BUFFER_MS;
  }

  const isActive = hasRuntimeState && !isExpired;

  // If the lifecycle evaluator previously failed but runtime state is still
  // active, recover lifecycle state so UI does not get stuck in "Paused".
  if (isActive && sessionRecord.lifecycleState === "failed") {
    const recoveredSession = await updateSession(sessionRecord.id, {
      lifecycleState: "active",
      lifecycleError: null,
      sandboxExpiresAt: getSandboxExpiresAtDate(sessionRecord.sandboxState),
    });
    if (recoveredSession) {
      effectiveSessionRecord = recoveredSession;
    }
  }

  // Safety net: if the sandbox has stale runtime state (expired or overdue for
  // hibernation), kick the lifecycle to clean up DB state in the background.
  if (hasRuntimeState && effectiveSessionRecord.lifecycleState === "active") {
    const now = Date.now();
    const dueAtMs = getLifecycleDueAtMs(effectiveSessionRecord);
    if (isExpired || now >= dueAtMs) {
      kickSandboxLifecycleWorkflow({
        sessionId: effectiveSessionRecord.id,
        reason: "status-check-overdue",
      });
    }
  }

  return Response.json({
    status: isActive ? "active" : "no_sandbox",
    hasSnapshot: hasPausedState,
    lifecycleVersion: effectiveSessionRecord.lifecycleVersion,
    lifecycle: {
      serverTime: Date.now(),
      state: effectiveSessionRecord.lifecycleState,
      lastActivityAt: effectiveSessionRecord.lastActivityAt?.getTime() ?? null,
      hibernateAfter: effectiveSessionRecord.hibernateAfter?.getTime() ?? null,
      sandboxExpiresAt:
        effectiveSessionRecord.sandboxExpiresAt?.getTime() ?? null,
    },
  } satisfies SandboxStatusResponse);
}
