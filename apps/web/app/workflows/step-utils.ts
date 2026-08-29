import type {
  FinishReason,
  LanguageModelUsage,
  ModelMessage,
  UIMessageChunk,
} from "ai";
import { getRun } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import type { WorkflowRunStepTiming } from "@/lib/db/workflow-runs";

export type StepWritable = WritableStream<UIMessageChunk>;

/**
 * Shared result contract for one agent step of the chat workflow. Both the
 * built-in open-agent step and the external-harness step return this shape so
 * the workflow loop can treat them uniformly: a single dispatch point picks
 * the step, and everything after it is keyed on these fields only.
 */
export type AgentStepResult = {
  /** Assistant message assembled by this step; undefined when aborted. */
  responseMessage: WebAgentUIMessage | undefined;
  /** Model messages to append to the next step's prompt (open-agent only). */
  responseMessages: ModelMessage[];
  finishReason: FinishReason;
  rawFinishReason: string | undefined;
  stepUsage: LanguageModelUsage | undefined;
  /** Step cost in USD, when the provider or harness reports one. */
  stepCost: number | undefined;
  stepWasAborted: boolean;
  stepTiming: WorkflowRunStepTiming;
  /**
   * Whether the workflow loop may run another step after this one. Computed
   * inside each step so the loop needs no per-step-kind continue logic.
   */
  canContinue: boolean;
  /**
   * Harness session resume state to persist for the next turn (null clears
   * the persisted state). Undefined when there is nothing to persist — the
   * open-agent step and aborted harness steps leave it unset.
   */
  harnessResumeState?: unknown;
  /**
   * User-facing failure text the workflow should append to the assistant
   * message and stream to the client. Set by the harness step when the turn
   * finished with reason "error".
   */
  userFacingErrorText?: string;
};

export function buildStepTiming(
  stepNumber: number,
  startedAt: Date,
  finishedAt: Date,
  finishReason?: string,
  rawFinishReason?: string,
): WorkflowRunStepTiming {
  return {
    stepNumber,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    finishReason,
    rawFinishReason,
  };
}

export function isStepTimingError(
  error: unknown,
): error is Error & { stepTiming: WorkflowRunStepTiming } {
  return (
    error instanceof Error &&
    "stepTiming" in error &&
    typeof error.stepTiming === "object" &&
    error.stepTiming !== null
  );
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll the workflow run status while a step is streaming so a cancelled run
 * aborts the in-flight model or harness call.
 */
export function startStopMonitor(
  runId: string,
  abortController: AbortController,
) {
  let shouldStop = false;

  const done = (async () => {
    const run = getRun(runId);

    while (!shouldStop && !abortController.signal.aborted) {
      let runStatus:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled";

      try {
        runStatus = await run.status;
      } catch {
        await delay(150);
        continue;
      }

      if (runStatus === "cancelled") {
        abortController.abort();
        return;
      }

      await delay(150);
    }
  })();

  return {
    stop() {
      shouldStop = true;
    },
    done,
  };
}
