import "server-only";

import { connectSandbox, type SandboxState } from "@open-agents/sandbox";
import {
  getChatsBySessionId,
  getSessionById,
  updateSession,
} from "@/lib/db/sessions";
import {
  SANDBOX_EXPIRES_BUFFER_MS,
  SANDBOX_INACTIVITY_TIMEOUT_MS,
} from "./config";
import {
  canOperateOnSandbox,
  clearSandboxState,
  getPersistentSandboxName,
} from "./utils";

export type SandboxLifecycleState =
  | "provisioning"
  | "active"
  | "hibernating"
  | "hibernated"
  | "restoring"
  | "archived"
  | "failed";

export type SandboxLifecycleReason =
  | "sandbox-created"
  | "timeout-extended"
  | "snapshot-restored"
  | "reconnect"
  | "manual-stop"
  | "status-check-overdue";

export interface SandboxLifecycleEvaluationResult {
  action: "skipped" | "hibernated" | "failed";
  reason?: string;
}

interface LifecycleTimingSource {
  hibernateAfter: Date | null;
  lastActivityAt: Date | null;
  sandboxExpiresAt: Date | null;
  updatedAt: Date;
}

type LifecycleUpdate = Parameters<typeof updateSession>[1];

export function getNextLifecycleVersion(
  currentVersion: number | null | undefined,
): number {
  return (currentVersion ?? 0) + 1;
}

export function getSandboxExpiresAtMs(
  sandboxState: SandboxState | null | undefined,
): number | undefined {
  if (!sandboxState || !("expiresAt" in sandboxState)) {
    return undefined;
  }
  return typeof sandboxState.expiresAt === "number"
    ? sandboxState.expiresAt
    : undefined;
}

export function getSandboxExpiresAtDate(
  sandboxState: SandboxState | null | undefined,
): Date | null {
  const expiresAtMs = getSandboxExpiresAtMs(sandboxState);
  return expiresAtMs === undefined ? null : new Date(expiresAtMs);
}

export function buildLifecycleActivityUpdate(
  activityAt: Date = new Date(),
  lifecycleState: Extract<
    SandboxLifecycleState,
    "active" | "restoring"
  > = "active",
): Pick<
  LifecycleUpdate,
  "lifecycleState" | "lifecycleError" | "lastActivityAt" | "hibernateAfter"
> {
  return {
    lifecycleState,
    lifecycleError: null,
    lastActivityAt: activityAt,
    hibernateAfter: new Date(
      activityAt.getTime() + SANDBOX_INACTIVITY_TIMEOUT_MS,
    ),
  };
}

export function buildActiveLifecycleUpdate(
  sandboxState: SandboxState | null | undefined,
  options?: {
    activityAt?: Date;
    lifecycleState?: Extract<SandboxLifecycleState, "active" | "restoring">;
  },
): LifecycleUpdate {
  const activityAt = options?.activityAt ?? new Date();

  return {
    ...buildLifecycleActivityUpdate(
      activityAt,
      options?.lifecycleState ?? "active",
    ),
    sandboxExpiresAt: getSandboxExpiresAtDate(sandboxState),
  };
}

export function buildHibernatedLifecycleUpdate(): LifecycleUpdate {
  return {
    lifecycleState: "hibernated",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  };
}

function getInactivityDueAtMs(source: LifecycleTimingSource): number {
  if (source.hibernateAfter) {
    return source.hibernateAfter.getTime();
  }

  const lastActivityMs =
    source.lastActivityAt?.getTime() ?? source.updatedAt.getTime();
  return lastActivityMs + SANDBOX_INACTIVITY_TIMEOUT_MS;
}

function getExpiryDueAtMs(source: LifecycleTimingSource): number | null {
  if (!source.sandboxExpiresAt) {
    return null;
  }
  return source.sandboxExpiresAt.getTime() - SANDBOX_EXPIRES_BUFFER_MS;
}

export function getLifecycleDueAtMs(source: LifecycleTimingSource): number {
  const inactivityDueAtMs = getInactivityDueAtMs(source);
  const expiryDueAtMs = getExpiryDueAtMs(source);
  if (expiryDueAtMs === null) {
    return inactivityDueAtMs;
  }
  return Math.min(inactivityDueAtMs, expiryDueAtMs);
}

async function hasActiveStreamForSession(sessionId: string): Promise<boolean> {
  const chatsInSession = await getChatsBySessionId(sessionId);
  return chatsInSession.some((chat) => chat.activeStreamId !== null);
}

async function restoreActiveLifecycleState(
  sessionId: string,
  sandboxState: SandboxState,
): Promise<void> {
  await updateSession(sessionId, {
    lifecycleState: "active",
    lifecycleError: null,
    sandboxExpiresAt: getSandboxExpiresAtDate(sandboxState),
  });
}

/**
 * One-shot lifecycle evaluator for workflow orchestration.
 *
 * This performs a single evaluation pass and exits.
 * The durable workflow loops and calls this when it wakes.
 */
export async function evaluateSandboxLifecycle(
  sessionId: string,
  reason: SandboxLifecycleReason,
): Promise<SandboxLifecycleEvaluationResult> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return { action: "skipped", reason: "session-not-found" };
  }

  if (session.status === "archived" || session.lifecycleState === "archived") {
    return { action: "skipped", reason: "session-archived" };
  }

  const sandboxState = session.sandboxState;
  if (!canOperateOnSandbox(sandboxState)) {
    return { action: "skipped", reason: "sandbox-not-operable" };
  }
  if (sandboxState.type !== "vercel") {
    return { action: "skipped", reason: "unsupported-sandbox-type" };
  }

  const nowMs = Date.now();
  const dueAtMs = getLifecycleDueAtMs(session);
  const isInactive = nowMs >= dueAtMs;

  if (!isInactive) {
    return { action: "skipped", reason: "not-due-yet" };
  }

  if (await hasActiveStreamForSession(sessionId)) {
    return { action: "skipped", reason: "active-workflow" };
  }

  try {
    await updateSession(sessionId, {
      lifecycleState: "hibernating",
      lifecycleError: null,
    });

    const sandbox = await connectSandbox(sandboxState);

    if (await hasActiveStreamForSession(sessionId)) {
      await restoreActiveLifecycleState(sessionId, sandboxState);
      return { action: "skipped", reason: "active-workflow" };
    }

    const refreshedSession = await getSessionById(sessionId);
    if (
      refreshedSession?.sandboxState &&
      canOperateOnSandbox(refreshedSession.sandboxState)
    ) {
      const lifecycleTimingChanged =
        refreshedSession.lastActivityAt?.getTime() !==
          session.lastActivityAt?.getTime() ||
        refreshedSession.hibernateAfter?.getTime() !==
          session.hibernateAfter?.getTime() ||
        refreshedSession.sandboxExpiresAt?.getTime() !==
          session.sandboxExpiresAt?.getTime();

      if (
        lifecycleTimingChanged &&
        Date.now() < getLifecycleDueAtMs(refreshedSession)
      ) {
        await restoreActiveLifecycleState(
          sessionId,
          refreshedSession.sandboxState,
        );
        return { action: "skipped", reason: "not-due-yet" };
      }
    }

    await sandbox.stop();

    const clearedState = clearSandboxState(sandboxState);
    await updateSession(sessionId, {
      snapshotUrl: null,
      snapshotCreatedAt: null,
      sandboxState: clearedState,
      ...buildHibernatedLifecycleUpdate(),
    });
    console.log(
      `[Lifecycle] Hibernated sandbox for session ${sessionId} (reason=${reason}, sandboxName=${getPersistentSandboxName(clearedState) ?? "none"}).`,
    );
    return { action: "hibernated" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateSession(sessionId, {
      lifecycleState: "failed",
      lifecycleRunId: null,
      lifecycleError: message,
    });
    console.error(
      `[Lifecycle] Failed to evaluate sandbox lifecycle for session ${sessionId}:`,
      error,
    );
    return { action: "failed", reason: message };
  }
}
