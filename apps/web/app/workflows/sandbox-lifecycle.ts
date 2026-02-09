import { sleep } from "workflow";
import { getSessionById } from "@/lib/db/sessions";
import { SANDBOX_HARD_TIMEOUT_GUARD_MS } from "@/lib/sandbox/config";
import {
  evaluateSandboxLifecycle,
  getSandboxExpiresAtMs,
  type SandboxLifecycleEvaluationResult,
  type SandboxLifecycleReason,
} from "@/lib/sandbox/lifecycle";
import { canOperateOnSandbox } from "@/lib/sandbox/utils";

interface LifecycleWakeDecision {
  shouldContinue: boolean;
  wakeAtMs?: number;
  reason?: string;
}

async function computeLifecycleWakeDecision(
  sessionId: string,
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
  if (!canOperateOnSandbox(state) || state.type === "just-bash") {
    return { shouldContinue: false, reason: "sandbox-not-operable" };
  }

  const expiresAtMs =
    getSandboxExpiresAtMs(state) ?? session.sandboxExpiresAt?.getTime();
  if (expiresAtMs === undefined) {
    return { shouldContinue: false, reason: "missing-expiry" };
  }

  const wakeCandidates = [expiresAtMs - SANDBOX_HARD_TIMEOUT_GUARD_MS];
  if (session.hibernateAfter) {
    wakeCandidates.push(session.hibernateAfter.getTime());
  }

  return {
    shouldContinue: true,
    wakeAtMs: Math.min(...wakeCandidates),
  };
}

async function runLifecycleEvaluation(
  sessionId: string,
  reason: SandboxLifecycleReason,
): Promise<SandboxLifecycleEvaluationResult> {
  "use step";
  return evaluateSandboxLifecycle(sessionId, reason);
}

export async function sandboxLifecycleWorkflow(
  sessionId: string,
  reason: SandboxLifecycleReason,
) {
  "use workflow";

  const decision = await computeLifecycleWakeDecision(sessionId);
  if (!decision.shouldContinue || decision.wakeAtMs === undefined) {
    return { skipped: true, reason: decision.reason ?? "no-decision" };
  }

  const now = Date.now();
  if (decision.wakeAtMs > now) {
    await sleep(new Date(decision.wakeAtMs));
  }

  const evaluation = await runLifecycleEvaluation(sessionId, reason);

  // If the evaluation skipped because activity happened during the sleep,
  // re-compute the next wake time and try once more. Without this retry,
  // the sandbox would never hibernate until a new event kicks a fresh workflow.
  if (evaluation.action === "skipped" && evaluation.reason === "not-due-yet") {
    const retryDecision = await computeLifecycleWakeDecision(sessionId);
    if (!retryDecision.shouldContinue || retryDecision.wakeAtMs === undefined) {
      return {
        skipped: true,
        reason: retryDecision.reason ?? "no-decision-on-retry",
      };
    }

    const retryNow = Date.now();
    if (retryDecision.wakeAtMs > retryNow) {
      await sleep(new Date(retryDecision.wakeAtMs));
    }

    const retryEvaluation = await runLifecycleEvaluation(sessionId, reason);
    return { skipped: false, evaluation: retryEvaluation };
  }

  return { skipped: false, evaluation };
}
