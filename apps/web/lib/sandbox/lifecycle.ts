import "server-only";

import {
  connectSandbox,
  type SandboxState,
  type SnapshotResult,
} from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  DEFAULT_SANDBOX_TIMEOUT_MS,
  SANDBOX_HARD_TIMEOUT_GUARD_MS,
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
  | "cloud-ready"
  | "chat-started"
  | "chat-finished"
  | "timeout-extended"
  | "manual-snapshot"
  | "snapshot-restored"
  | "reconnect"
  | "manual-stop"
  | "status-check-overdue";

export interface SandboxLifecycleEvaluationResult {
  action: "skipped" | "hibernated" | "rolled-over" | "failed";
  reason?: string;
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
    lifecycleError: null,
  };
}

/**
 * One-shot lifecycle evaluator for event-kicked orchestration.
 *
 * This intentionally performs a single evaluation pass and exits.
 * Callers kick it from lifecycle events (create, chat-finished, extend, etc).
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

  const lifecycleRunId = `${reason}:${Date.now()}`;
  await updateSession(sessionId, { lifecycleRunId });

  const sandboxState = session.sandboxState;
  if (!canOperateOnSandbox(sandboxState)) {
    return { action: "skipped", reason: "sandbox-not-operable" };
  }
  if (sandboxState.type === "just-bash") {
    return { action: "skipped", reason: "just-bash" };
  }

  const expiresAtMs =
    getSandboxExpiresAtMs(sandboxState) ?? session.sandboxExpiresAt?.getTime();
  if (expiresAtMs === undefined) {
    return { action: "skipped", reason: "missing-expires-at" };
  }

  const nowMs = Date.now();
  const lastActivityMs =
    session.lastActivityAt?.getTime() ?? session.updatedAt.getTime();
  const hibernateAfterMs = lastActivityMs + SANDBOX_INACTIVITY_TIMEOUT_MS;

  const isInactive = nowMs >= hibernateAfterMs;
  const nearHardTimeout = nowMs >= expiresAtMs - SANDBOX_HARD_TIMEOUT_GUARD_MS;

  if (!isInactive && !nearHardTimeout) {
    return { action: "skipped", reason: "not-due-yet" };
  }

  try {
    await updateSession(sessionId, {
      lifecycleState: "hibernating",
      lifecycleError: null,
    });

    const sandbox = await connectSandbox(sandboxState);
    if (!sandbox.snapshot) {
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
          await updateSession(sessionId, {
            ...buildActiveLifecycleUpdate(refreshedSession.sandboxState),
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

    // Hard-timeout rollover for active sessions: snapshot (which stops the old
    // sandbox), then immediately restore into a fresh sandbox generation.
    if (nearHardTimeout && !isInactive) {
      await updateSession(sessionId, {
        lifecycleState: "restoring",
        snapshotUrl: snapshot.snapshotId,
        snapshotCreatedAt,
      });

      const restoredSandbox = await connectSandbox(
        { type: sandboxState.type, snapshotId: snapshot.snapshotId },
        { timeout: DEFAULT_SANDBOX_TIMEOUT_MS },
      );

      const restoredState =
        (restoredSandbox.getState?.() as SandboxState | undefined) ??
        ({ type: sandboxState.type } as SandboxState);
      const activityAt = new Date();

      await updateSession(sessionId, {
        snapshotUrl: snapshot.snapshotId,
        snapshotCreatedAt,
        sandboxState: restoredState,
        ...buildActiveLifecycleUpdate(restoredState, {
          activityAt,
          lifecycleState: "active",
        }),
      });
      console.log(
        `[Lifecycle] Rolled over sandbox for session ${sessionId} (reason=${reason}, snapshotId=${snapshot.snapshotId}).`,
      );
      return { action: "rolled-over" };
    }

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
      lifecycleError: message,
    });
    console.error(
      `[Lifecycle] Failed to evaluate sandbox lifecycle for session ${sessionId}:`,
      error,
    );
    return { action: "failed", reason: message };
  }
}
