import "server-only";

import { start, getRun } from "workflow/api";
import { sandboxProvisioningWorkflow } from "@/app/workflows/sandbox-provisioning";
import {
  clearSessionSandboxProvisioningRunIdIfOwned,
  claimSessionSandboxProvisioningRunId,
  getSessionById,
  updateSession,
} from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";

type KickSandboxProvisioningResult =
  | {
      status: "started" | "existing";
      runId: string;
    }
  | {
      status: "active" | "skipped";
      runId?: undefined;
    };

async function isRunStillLive(runId: string): Promise<boolean> {
  try {
    const run = getRun(runId);
    if (!(await run.exists)) {
      return false;
    }
    const status = await run.status;
    return status === "pending" || status === "running";
  } catch {
    return false;
  }
}

export async function kickSandboxProvisioningWorkflow(
  sessionId: string,
): Promise<KickSandboxProvisioningResult> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return { status: "skipped" };
  }
  if (session.status === "archived") {
    return { status: "skipped" };
  }
  if (isSandboxActive(session.sandboxState)) {
    return { status: "active" };
  }

  if (session.sandboxProvisioningRunId) {
    const live = await isRunStillLive(session.sandboxProvisioningRunId);
    if (live) {
      return {
        status: "existing",
        runId: session.sandboxProvisioningRunId,
      };
    }
    const cleared = await clearSessionSandboxProvisioningRunIdIfOwned(
      sessionId,
      session.sandboxProvisioningRunId,
    );
    if (!cleared) {
      const latest = await getSessionById(sessionId);
      if (!latest || latest.status === "archived") {
        return { status: "skipped" };
      }
      if (isSandboxActive(latest.sandboxState)) {
        return { status: "active" };
      }
      if (latest.sandboxProvisioningRunId) {
        return { status: "existing", runId: latest.sandboxProvisioningRunId };
      }
    }
  }

  const run = await start(sandboxProvisioningWorkflow, [sessionId]);
  const claimed = await claimSessionSandboxProvisioningRunId(
    sessionId,
    run.runId,
  );
  if (claimed) {
    await updateSession(sessionId, {
      lifecycleState: "provisioning",
      lifecycleError: null,
    });
    return { status: "started", runId: run.runId };
  }

  const latest = await getSessionById(sessionId);
  if (latest?.sandboxProvisioningRunId === run.runId) {
    await updateSession(sessionId, {
      lifecycleState: "provisioning",
      lifecycleError: null,
    });
    return { status: "started", runId: run.runId };
  }
  if (latest?.sandboxProvisioningRunId) {
    return { status: "existing", runId: latest.sandboxProvisioningRunId };
  }

  try {
    getRun(run.runId).cancel();
  } catch {
    // Best-effort cleanup for a duplicate run.
  }

  return { status: "skipped" };
}

export async function waitForSandboxProvisioningRun(runId: string) {
  const run = getRun(runId);
  return run.returnValue;
}
