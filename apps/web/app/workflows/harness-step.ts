import type { OpenAgentCallOptions } from "@open-agents/agent";
import type {
  ExternalHarnessId,
  HarnessTurnErrorCode,
} from "@open-agents/harness-runner";
import type { UIMessage } from "ai";
import type { WebAgentUIMessage } from "@/app/types";
import { getChatHarnessLabel } from "@/lib/chat-harnesses";
import { getChatById } from "@/lib/db/sessions";
import {
  type AgentStepResult,
  buildStepTiming,
  isAbortError,
  startStopMonitor,
  type StepWritable,
} from "./step-utils";

/** The harness runner rejects session keys longer than this. */
const HARNESS_SESSION_KEY_MAX_LENGTH = 128;

/**
 * Key the harness session to the chat (not the message) so every turn of a
 * chat resumes the same underlying harness session.
 */
export function buildHarnessSessionKey(
  harnessId: ExternalHarnessId,
  chatId: string,
): string {
  return `${harnessId}-${chatId}`.slice(0, HARNESS_SESSION_KEY_MAX_LENGTH);
}

/**
 * User-facing copy for the runner's machine-readable failure codes. The
 * runner classifies known failure modes where the raw failure text
 * originates; anything unclassified falls back to the raw finish reason.
 */
const HARNESS_ERROR_COPY: Record<HarnessTurnErrorCode, string> = {
  "missing-ws-module":
    "because this sandbox is missing the prepared harness runtime. Recreate the sandbox and try again.",
  "gateway-auth-failed":
    "because AI Gateway rejected the configured credentials. Check AI_GATEWAY_API_KEY or Vercel OIDC for this deployment and try again.",
  "bridge-not-ready":
    "because the sandbox bridge did not start. Recreate the sandbox and try again.",
};

const MAX_RAW_REASON_LENGTH = 500;

export function getHarnessErrorMessage(params: {
  harnessLabel: string;
  errorCode: HarnessTurnErrorCode | undefined;
  rawFinishReason: string | undefined;
  hasPartialResponse: boolean;
}): string {
  const timing = params.hasPartialResponse
    ? "after producing a partial response"
    : "before it could respond";
  const failed = `${params.harnessLabel} failed ${timing}`;

  if (params.errorCode) {
    return `${failed} ${HARNESS_ERROR_COPY[params.errorCode]}`;
  }

  if (!params.rawFinishReason) {
    return `${failed}. Try again in a moment.`;
  }

  const reason =
    params.rawFinishReason.length > MAX_RAW_REASON_LENGTH
      ? `${params.rawFinishReason.slice(0, MAX_RAW_REASON_LENGTH)}...`
      : params.rawFinishReason;
  return `${failed}: ${reason}`;
}

/**
 * The harness runner speaks plain AI SDK `UIMessage`s. The web app's
 * `WebAgentUIMessage` only narrows the metadata/data-part/tool typings of the
 * same runtime shape, and the runner normalizes tool parts server-side, so
 * this conversion re-labels the payload without transforming it. Keep this as
 * the single crossing point from runner messages into web-app messages.
 */
function toWebAgentUIMessage(message: UIMessage): WebAgentUIMessage {
  return message as WebAgentUIMessage;
}

export type RunHarnessAgentStepParams = {
  harnessId: ExternalHarnessId;
  messages: WebAgentUIMessage[];
  originalMessages: WebAgentUIMessage[];
  messageId: string;
  workflowRunId: string;
  chatId: string;
  selectedModelId: string;
  modelId: string;
  sandboxState: OpenAgentCallOptions["sandbox"]["state"];
  workingDirectory: string;
  requestUrl: string;
  stepNumber: number;
};

/**
 * Run one external-harness turn as a workflow step. The writable stays a
 * direct argument (not a params field), matching how every other step in this
 * workflow receives the run's stream handle.
 */
export const runHarnessAgentStep = async (
  params: RunHarnessAgentStepParams,
  writable: StepWritable,
): Promise<AgentStepResult> => {
  "use step";

  const stepStartedAt = new Date();
  const abortController = new AbortController();
  const stopMonitor = startStopMonitor(params.workflowRunId, abortController);

  try {
    // Read the previous turn's resume state inside the step so the harness
    // session plumbing stays out of the shared model-runtime resolution.
    const chat = await getChatById(params.chatId);
    const harnessSessionState = chat?.harnessSessionState;
    const { runHarnessTurnViaApi } =
      await import("@/lib/harness-runner/client");
    const result = await runHarnessTurnViaApi({
      harnessId: params.harnessId,
      sandboxState: params.sandboxState,
      workingDirectory: params.workingDirectory,
      sessionId: buildHarnessSessionKey(params.harnessId, params.chatId),
      messageId: params.messageId,
      messages: params.messages,
      originalMessages: params.originalMessages,
      selectedModelId: params.selectedModelId,
      modelId: params.modelId,
      ...(harnessSessionState != null
        ? { resumeState: harnessSessionState }
        : {}),
      requestUrl: params.requestUrl,
      abortSignal: abortController.signal,
      onChunk: async (chunk) => {
        const writer = writable.getWriter();
        try {
          await writer.write(chunk);
        } finally {
          writer.releaseLock();
        }
      },
    });
    const responseMessage = toWebAgentUIMessage(result.responseMessage);
    const hasPartialResponse = responseMessage.parts.length > 0;
    const errorText =
      result.finishReason === "error"
        ? getHarnessErrorMessage({
            harnessLabel: getChatHarnessLabel(params.harnessId),
            errorCode: result.errorCode,
            rawFinishReason: result.rawFinishReason,
            hasPartialResponse,
          })
        : undefined;
    const stepFinishedAt = new Date();

    return {
      responseMessage,
      responseMessages: [],
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
      // HarnessUsage extends LanguageModelUsage, so it is used as-is; only
      // the harness-reported dollar cost needs lifting out.
      stepUsage: result.usage,
      stepCost: result.usage?.costUsd,
      stepWasAborted: false,
      // External harnesses run their whole turn (including tool calls) inside
      // the sandbox bridge; one step is always the whole turn.
      canContinue: false,
      // null (rather than undefined) clears state the previous turn persisted.
      harnessResumeState: result.resumeState ?? null,
      ...(errorText !== undefined
        ? {
            userFacingErrorText: hasPartialResponse
              ? `\n\n${errorText}`
              : errorText,
          }
        : {}),
      stepTiming: buildStepTiming(
        params.stepNumber,
        stepStartedAt,
        stepFinishedAt,
        result.finishReason,
        result.rawFinishReason,
      ),
    };
  } catch (error) {
    const stepFinishedAt = new Date();

    if (isAbortError(error)) {
      return {
        responseMessage: undefined,
        responseMessages: [],
        finishReason: "stop",
        rawFinishReason: undefined,
        stepUsage: undefined,
        stepCost: undefined,
        stepWasAborted: true,
        canContinue: false,
        stepTiming: buildStepTiming(
          params.stepNumber,
          stepStartedAt,
          stepFinishedAt,
          "stop",
        ),
      };
    }

    const errorWithStepTiming =
      error instanceof Error ? error : new Error(String(error));
    Object.assign(errorWithStepTiming, {
      stepTiming: buildStepTiming(
        params.stepNumber,
        stepStartedAt,
        stepFinishedAt,
        "error",
        errorWithStepTiming.name,
      ),
    });
    throw errorWithStepTiming;
  } finally {
    stopMonitor.stop();
    await stopMonitor.done;
  }
};
