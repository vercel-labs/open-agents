import { sleep } from "workflow";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { SANDBOX_LIFECYCLE_MIN_SLEEP_MS } from "@/lib/sandbox/config";
import {
  evaluateSandboxLifecycle,
  getLifecycleDueAtMs,
  type SandboxLifecycleEvaluationResult,
  type SandboxLifecycleReason,
} from "@/lib/sandbox/lifecycle";
import { canOperateOnSandbox } from "@/lib/sandbox/utils";

interface LifecycleWakeDecision {
  shouldContinue: boolean;
  wakeAtMs?: number;
  reason?: string;
}

async function claimLifecycleLease(
  sessionId: string,
  runId: string,
): Promise<boolean> {
  const current = await getSessionById(sessionId);
  if (!current) {
    return false;
  }

  if (current.lifecycleRunId && current.lifecycleRunId !== runId) {
    return false;
  }

  if (current.lifecycleRunId !== runId) {
    await updateSession(sessionId, { lifecycleRunId: runId });
  }

  const verified = await getSessionById(sessionId);
  return verified?.lifecycleRunId === runId;
}

async function computeLifecycleWakeDecision(
  sessionId: string,
  runId: string,
): Promise<LifecycleWakeDecision> {
  "use step";

  const session = await getSessionById(sessionId);
  if (!session) {
    return { shouldContinue: false, reason: "session-not-found" };
  }
  if (session.status === "archived" || session.lifecycleState === "archived") {
    return { shouldContinue: false, reason: "session-archived" };
  }

  const state = session.sandboxState;
  if (!canOperateOnSandbox(state) || state.type !== "vercel") {
    return { shouldContinue: false, reason: "sandbox-not-operable" };
  }
  if (!(await claimLifecycleLease(sessionId, runId))) {
    return { shouldContinue: false, reason: "run-replaced" };
  }

  return {
    shouldContinue: true,
    wakeAtMs: getLifecycleDueAtMs(session),
  };
}

async function runLifecycleEvaluation(
  sessionId: string,
  reason: SandboxLifecycleReason,
): Promise<SandboxLifecycleEvaluationResult> {
  "use step";
  return evaluateSandboxLifecycle(sessionId, reason);
}

async function clearLifecycleRunIdIfOwned(
  sessionId: string,
  runId: string,
): Promise<void> {
  "use step";

  const session = await getSessionById(sessionId);
  if (!session || session.lifecycleRunId !== runId) {
    return;
  }

  await updateSession(sessionId, { lifecycleRunId: null });
}

export async function sandboxLifecycleWorkflow(
  sessionId: string,
  reason: SandboxLifecycleReason,
  runId: string,
) {
  "use workflow";
  while (true) {
    const decision = await computeLifecycleWakeDecision(sessionId, runId);
    if (!decision.shouldContinue || decision.wakeAtMs === undefined) {
      await clearLifecycleRunIdIfOwned(sessionId, runId);
      return { skipped: true, reason: decision.reason ?? "no-decision" };
    }

    const now = Date.now();
    const wakeAtMs = Math.max(
      decision.wakeAtMs,
      now + SANDBOX_LIFECYCLE_MIN_SLEEP_MS,
    );
    await sleep(new Date(wakeAtMs));

    const evaluation = await runLifecycleEvaluation(sessionId, reason);

    if (
      evaluation.action === "skipped" &&
      evaluation.reason === "not-due-yet"
    ) {
      continue;
    }

    await clearLifecycleRunIdIfOwned(sessionId, runId);
    return { skipped: false, evaluation };
  }
}
