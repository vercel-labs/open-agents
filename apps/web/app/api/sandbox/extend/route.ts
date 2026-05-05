import { connectSandbox, type SandboxState } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { EXTEND_TIMEOUT_DURATION_MS } from "@/lib/sandbox/config";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { checkBotProtection } from "@/lib/botid";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

interface ExtendRequest {
  sessionId: string;
}

export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["sandbox-extend", authResult.userId]),
    limit: 3,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
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

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Sandbox not initialized",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
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
          lifecycleVersion: getNextLifecycleVersion(
            sessionRecord.lifecycleVersion,
          ),
          ...buildActiveLifecycleUpdate(newState as SandboxState),
        });
      }
    }

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "timeout-extended",
    });

    return Response.json({
      success: true,
      expiresAt: result.expiresAt,
      extendedBy: EXTEND_TIMEOUT_DURATION_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to extend sandbox timeout:", message);
    return Response.json(
      { error: "Failed to extend sandbox timeout" },
      { status: 500 },
    );
  }
}
