import type { NextRequest } from "next/server";
import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import {
  computeAndCacheDiff,
  DiffComputationError,
} from "@/lib/diff/compute-diff";
import { updateSession } from "@/lib/db/sessions";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearUnavailableSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";

export type { DiffFile, DiffResponse } from "@/lib/diff/compute-diff";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_req: NextRequest, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: hasRuntimeSandboxState,
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
    const response = await computeAndCacheDiff({ sandbox, sessionId });
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearUnavailableSandboxState(
          sessionRecord.sandboxState,
          message,
        ),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        { error: "Sandbox is unavailable. Please resume sandbox." },
        { status: 409 },
      );
    }

    if (error instanceof DiffComputationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to get diff:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
