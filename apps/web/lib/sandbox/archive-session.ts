import "server-only";

import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  findPullRequestByBranch,
  getPullRequestStatus,
} from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";
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

function getSessionRepoUrl(session: SessionRecord): string | null {
  const cloneUrl = session.cloneUrl?.trim();
  if (cloneUrl) {
    return cloneUrl;
  }

  if (!session.repoOwner || !session.repoName) {
    return null;
  }

  return `https://github.com/${session.repoOwner}/${session.repoName}`;
}

async function refreshArchiveGitState(
  currentSession: SessionRecord,
  logPrefix: string,
): Promise<SessionUpdateInput> {
  if (!canOperateOnSandbox(currentSession.sandboxState)) {
    return {};
  }

  if (!currentSession.repoOwner || !currentSession.repoName) {
    return {};
  }

  try {
    const sandbox = await connectSandbox(currentSession.sandboxState);
    const cwd = sandbox.workingDirectory;
    const branchResult = await sandbox.exec(
      "git symbolic-ref --short HEAD",
      cwd,
      10000,
    );

    const branch = branchResult.success ? branchResult.stdout.trim() : "";
    if (!branch) {
      return {};
    }

    const updates: SessionUpdateInput = {};
    const branchChanged = branch !== currentSession.branch;

    if (branchChanged) {
      updates.branch = branch;
    }

    const token =
      (await getUserGitHubToken(currentSession.userId)) ?? undefined;

    if (!branchChanged && currentSession.prNumber != null) {
      const repoUrl = getSessionRepoUrl(currentSession);
      if (repoUrl) {
        const prStatusResult = await getPullRequestStatus({
          repoUrl,
          prNumber: currentSession.prNumber,
          token,
        });

        if (prStatusResult.success && prStatusResult.status) {
          if (prStatusResult.status !== currentSession.prStatus) {
            updates.prStatus = prStatusResult.status;
          }

          return updates;
        }
      }
    }

    if (!token) {
      return updates;
    }

    const prResult = await findPullRequestByBranch({
      owner: currentSession.repoOwner,
      repo: currentSession.repoName,
      branchName: branch,
      token,
    });

    if (prResult.error) {
      return updates;
    }

    if (prResult.found && prResult.prNumber && prResult.prStatus) {
      if (prResult.prNumber !== currentSession.prNumber) {
        updates.prNumber = prResult.prNumber;
      }

      if (prResult.prStatus !== currentSession.prStatus) {
        updates.prStatus = prResult.prStatus;
      }

      return updates;
    }

    if (
      currentSession.prNumber !== null ||
      currentSession.prStatus !== null ||
      updates.prNumber !== undefined ||
      updates.prStatus !== undefined
    ) {
      updates.prNumber = null;
      updates.prStatus = null;
    }

    return updates;
  } catch (error) {
    console.warn(
      `${logPrefix} Failed to refresh git/PR state before archiving session ${currentSession.id}:`,
      error,
    );
    return {};
  }
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
    await sandbox.stop();

    await updateSession(sessionId, {
      snapshotUrl: null,
      snapshotCreatedAt: null,
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
  const logPrefix = options.logPrefix ?? "[Sessions]";
  const gitStateUpdate = shouldStopSandboxAfterArchive
    ? await refreshArchiveGitState(currentSession, logPrefix)
    : {};

  const updatePayload: SessionUpdateInput = {
    ...gitStateUpdate,
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
