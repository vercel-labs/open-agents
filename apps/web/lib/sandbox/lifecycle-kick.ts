import "server-only";

import { start } from "workflow/api";
import { updateSession } from "@/lib/db/sessions";
import { sandboxLifecycleWorkflow } from "@/app/workflows/sandbox-lifecycle";
import {
  evaluateSandboxLifecycle,
  type SandboxLifecycleReason,
} from "./lifecycle";

interface KickSandboxLifecycleInput {
  sessionId: string;
  reason: SandboxLifecycleReason;
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

async function startLifecycleRun(
  sessionId: string,
  reason: SandboxLifecycleReason,
) {
  try {
    const run = await start(sandboxLifecycleWorkflow, [sessionId, reason]);
    await updateSession(sessionId, { lifecycleRunId: run.runId });
    console.log(
      `[Lifecycle] Started workflow run ${run.runId} for session ${sessionId} (reason=${reason}).`,
    );
  } catch (error) {
    console.error(
      `[Lifecycle] Failed to start workflow run for session ${sessionId}; using inline fallback:`,
      error,
    );
    const fallbackResult = await evaluateSandboxLifecycle(sessionId, reason);
    console.log(
      `[Lifecycle] Inline fallback completed for session ${sessionId} (reason=${reason}, action=${fallbackResult.action}${fallbackResult.reason ? `, detail=${fallbackResult.reason}` : ""}).`,
    );
  }
}

export function kickSandboxLifecycleWorkflow(input: KickSandboxLifecycleInput) {
  const run = async () => {
    await startLifecycleRun(input.sessionId, input.reason);
  };

  if (input.scheduleBackgroundWork) {
    input.scheduleBackgroundWork(run);
    return;
  }

  void run();
}
