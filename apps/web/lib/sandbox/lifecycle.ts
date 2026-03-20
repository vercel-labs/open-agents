import "server-only";

import {
  connectSandbox,
  type SandboxState,
  type SnapshotResult,
} from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  SANDBOX_EXPIRES_BUFFER_MS,
  SANDBOX_INACTIVITY_TIMEOUT_MS,
} from "./config";
import { canOperateOnSandbox, clearSandboxState } from "./utils";

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

function extractSnapshotConflictDetails(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }
  if (typeof error === "string") {
    parts.push(error);
  }
  if (error && typeof error === "object") {
    const withText = error as { text?: unknown; json?: unknown };
    if (typeof withText.text === "string") {
      parts.push(withText.text);
    }
    if (withText.json !== undefined) {
      parts.push(JSON.stringify(withText.json));
    }
  }

  return parts.join(" ");
}

function isSnapshotAlreadyInProgressError(error: unknown): boolean {
  const details = extractSnapshotConflictDetails(error).toLowerCase();
  return (
    details.includes("sandbox_snapshotting") ||
    details.includes("creating a snapshot and will be stopped shortly")
  );
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

export function buildActiveLifecycleUpdate(
  sandboxState: SandboxState | null | undefined,
  options?: {
    activityAt?: Date;
    lifecycleState?: Extract<SandboxLifecycleState, "active" | "restoring">;
  },
): LifecycleUpdate {
  const activityAt = options?.activityAt ?? new Date();

  return {
    lifecycleState: options?.lifecycleState ?? "active",
    lifecycleError: null,
    lastActivityAt: activityAt,
    hibernateAfter: new Date(
      activityAt.getTime() + SANDBOX_INACTIVITY_TIMEOUT_MS,
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

async function hasActiveWorkflowForSession(
  sessionId: string,
): Promise<boolean> {
  const { compareAndSetChatActiveStreamId, getChatsBySessionId } =
    await import("@/lib/db/sessions");
  const chatsInSession = await getChatsBySessionId(sessionId);
  const { getRun } = await import("workflow/api");

  for (const chat of chatsInSession) {
    const activeStreamId = chat.activeStreamId;
    if (!activeStreamId) {
      continue;
    }

    try {
      const run = getRun(activeStreamId);
      const status = await run.status;

      if (status === "running" || status === "pending") {
        return true;
      }
    } catch (error) {
      console.warn(
        `[Lifecycle] Failed to read workflow status for run ${activeStreamId} in chat ${chat.id}; skipping hibernation to avoid interrupting a live workflow.`,
        error,
      );
      return true;
    }

    await compareAndSetChatActiveStreamId(chat.id, activeStreamId, null);
  }

  return false;
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

  if (await hasActiveWorkflowForSession(sessionId)) {
    return { action: "skipped", reason: "active-workflow" };
  }

  try {
    await updateSession(sessionId, {
      lifecycleState: "hibernating",
      lifecycleError: null,
    });

    const sandbox = await connectSandbox(sandboxState);
    if (!sandbox.snapshot) {
      await updateSession(sessionId, {
        ...buildActiveLifecycleUpdate(sandboxState),
      });
      return { action: "skipped", reason: "snapshot-not-supported" };
    }

    let snapshot: SnapshotResult;
    try {
      snapshot = await sandbox.snapshot();
    } catch (snapshotError) {
      if (isSnapshotAlreadyInProgressError(snapshotError)) {
        const refreshedSession = await getSessionById(sessionId);
        if (
          refreshedSession?.sandboxState &&
          canOperateOnSandbox(refreshedSession.sandboxState)
        ) {
          // Keep the lifecycle due immediately eligible for re-check; if a
          // snapshot is already in progress we should not refresh
          // lastActivityAt/hibernateAfter and accidentally extend "active" UI.
          await updateSession(sessionId, {
            lifecycleState: "active",
            lifecycleError: null,
            sandboxExpiresAt: getSandboxExpiresAtDate(
              refreshedSession.sandboxState,
            ),
          });
        } else {
          await updateSession(sessionId, {
            ...buildHibernatedLifecycleUpdate(),
          });
        }
        console.log(
          `[Lifecycle] Snapshot already in progress for session ${sessionId}; treating as idempotent.`,
        );
        return { action: "skipped", reason: "snapshot-already-in-progress" };
      }
      throw snapshotError;
    }

    const snapshotCreatedAt = new Date();

    await updateSession(sessionId, {
      snapshotUrl: snapshot.snapshotId,
      snapshotCreatedAt,
      sandboxState: clearSandboxState(sandboxState),
      ...buildHibernatedLifecycleUpdate(),
    });
    console.log(
      `[Lifecycle] Hibernated sandbox for session ${sessionId} (reason=${reason}, snapshotId=${snapshot.snapshotId}).`,
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
