import "server-only";

import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { canOperateOnSandbox, clearSandboxState } from "./utils";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type SessionUpdateInput = Parameters<typeof updateSession>[1];

interface ArchiveSessionOptions {
  currentSession?: SessionRecord;
  update?: SessionUpdateInput;
  logPrefix?: string;
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

interface ArchiveSessionResult {
  session: Awaited<ReturnType<typeof updateSession>> | null;
  archiveTriggered: boolean;
}

async function finalizeArchivedSessionSandbox(
  sessionId: string,
  logPrefix: string,
): Promise<void> {
  try {
    const archivedSession = await getSessionById(sessionId);
    if (!archivedSession || archivedSession.status !== "archived") {
      return;
    }
    if (!canOperateOnSandbox(archivedSession.sandboxState)) {
      return;
    }

    const sandbox = await connectSandbox(archivedSession.sandboxState);

    // Snapshot before stopping so the sandbox can be restored on unarchive.
    // snapshot() automatically stops the sandbox, so no separate stop() needed.
    let snapshotFields: {
      snapshotUrl?: string;
      snapshotCreatedAt?: Date;
    } = {};

    if (sandbox.snapshot) {
      try {
        const result = await sandbox.snapshot();
        snapshotFields = {
          snapshotUrl: result.snapshotId,
          snapshotCreatedAt: new Date(),
        };
      } catch (snapshotError) {
        console.error(
          `${logPrefix} Snapshot failed for session ${sessionId}, falling back to stop:`,
          snapshotError,
        );
        await sandbox.stop();
      }
    } else {
      await sandbox.stop();
    }

    await updateSession(sessionId, {
      ...snapshotFields,
      sandboxState: clearSandboxState(archivedSession.sandboxState),
      lifecycleState: "archived",
      sandboxExpiresAt: null,
      hibernateAfter: null,
      lifecycleError: null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      `${logPrefix} Failed to stop sandbox for archived session ${sessionId}:`,
      error,
    );

    try {
      const sessionAfterFailure = await getSessionById(sessionId);
      if (!sessionAfterFailure || sessionAfterFailure.status !== "archived") {
        return;
      }

      const failurePatch: SessionUpdateInput = {
        lifecycleState: "archived",
        sandboxExpiresAt: null,
        hibernateAfter: null,
        lifecycleError: `Archive finalization failed: ${errorMessage}`,
      };

      if (
        !sessionAfterFailure.snapshotUrl &&
        canOperateOnSandbox(sessionAfterFailure.sandboxState)
      ) {
        failurePatch.sandboxState = clearSandboxState(
          sessionAfterFailure.sandboxState,
        );
      }

      await updateSession(sessionId, failurePatch);
    } catch (persistError) {
      console.error(
        `${logPrefix} Failed to persist archive recovery state for session ${sessionId}:`,
        persistError,
      );
    }
  }
}

export async function archiveSession(
  sessionId: string,
  options: ArchiveSessionOptions = {},
): Promise<ArchiveSessionResult> {
  const currentSession =
    options.currentSession ?? (await getSessionById(sessionId));

  if (!currentSession) {
    return { session: null, archiveTriggered: false };
  }

  const shouldStopSandboxAfterArchive = currentSession.status !== "archived";
  const updatePayload: SessionUpdateInput = {
    ...options.update,
  };

  if (shouldStopSandboxAfterArchive) {
    updatePayload.status = "archived";
    updatePayload.lifecycleState = "archived";
    updatePayload.sandboxExpiresAt = null;
    updatePayload.hibernateAfter = null;
  }

  const updatedSession =
    Object.keys(updatePayload).length > 0
      ? ((await updateSession(sessionId, updatePayload)) ?? null)
      : currentSession;

  const archiveTriggered = shouldStopSandboxAfterArchive && !!updatedSession;

  if (archiveTriggered) {
    const logPrefix = options.logPrefix ?? "[Sessions]";
    const runFinalize = () =>
      finalizeArchivedSessionSandbox(sessionId, logPrefix);

    if (options.scheduleBackgroundWork) {
      options.scheduleBackgroundWork(runFinalize);
    } else {
      void runFinalize();
    }
  }

  return {
    session: updatedSession,
    archiveTriggered,
  };
}
