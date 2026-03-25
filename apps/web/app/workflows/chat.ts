import {
  convertToModelMessages,
  type FinishReason,
  generateId as generateIdAi,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessageChunk,
} from "ai";
import type { OpenHarnessAgentCallOptions } from "@open-harness/agent";
import { getWorkflowMetadata, getWritable } from "workflow";
import { getRun } from "workflow/api";
import { addLanguageModelUsage } from "./usage-utils";
import type {
  WebAgentMessageMetadata,
  WebAgentStepFinishMetadata,
  WebAgentUIMessage,
} from "@/app/types";
import {
  clearActiveStream,
  persistAssistantMessage,
  persistSandboxState,
  recordWorkflowUsage,
  refreshDiffCache,
  runAutoCommitStep,
} from "./chat-post-finish";

type Options = {
  messages: WebAgentUIMessage[];
  chatId: string;
  sessionId: string;
  userId: string;
  modelId: string;
  agentOptions: OpenHarnessAgentCallOptions;
  maxSteps?: number;
  /** Whether auto-commit+push should run after a natural finish. */
  autoCommitEnabled?: boolean;
  /** Session title for commit message generation. */
  sessionTitle?: string;
  /** GitHub repo owner (required for auto-commit and diff refresh). */
  repoOwner?: string;
  /** GitHub repo name (required for auto-commit). */
  repoName?: string;
};

type Writable = WritableStream<UIMessageChunk>;

const shouldPauseForToolInteraction = (parts: WebAgentUIMessage["parts"]) =>
  parts.some(
    (part) =>
      isToolUIPart(part) &&
      (part.state === "input-available" || part.state === "approval-requested"),
  );

const convertMessages = async (
  messages: WebAgentUIMessage[],
): Promise<ModelMessage[]> => {
  "use step";
  const { webAgent } = await import("@/app/config");
  return await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });
};

const generateId = async () => {
  "use step";
  return generateIdAi();
};

export async function runAgentWorkflow(options: Options) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const writable = getWritable<UIMessageChunk>();

  const latestMessage = options.messages.at(-1);

  if (latestMessage == null) {
    throw new Error("runAgentWorkflow requires at least one message");
  }

  const [modelMessages, assistantId] = await Promise.all([
    convertMessages(options.messages),
    latestMessage.role === "assistant"
      ? Promise.resolve(latestMessage.id)
      : generateId(),
  ]);

  let pendingAssistantResponse: WebAgentUIMessage =
    latestMessage.role === "assistant"
      ? {
          ...latestMessage,
          metadata: latestMessage.metadata ?? ({} as WebAgentMessageMetadata),
          parts: [...latestMessage.parts],
        }
      : {
          role: "assistant",
          id: assistantId,
          parts: [],
          metadata: {} as WebAgentMessageMetadata,
        };

  let originalMessagesForStep: WebAgentUIMessage[] = [latestMessage];

  await sendStart(writable, assistantId);

  let wasAborted = false;
  let totalUsage: LanguageModelUsage | undefined;
  let streamClosed = false;

  try {
    for (
      let step = 0;
      options.maxSteps === undefined || step < options.maxSteps;
      step++
    ) {
      const result = await runAgentStep(
        modelMessages,
        originalMessagesForStep,
        assistantId,
        writable,
        workflowRunId,
        options.agentOptions,
      );

      pendingAssistantResponse =
        result.responseMessage ?? pendingAssistantResponse;
      originalMessagesForStep = [pendingAssistantResponse];
      modelMessages.push(...result.responseMessages);
      wasAborted = wasAborted || result.stepWasAborted;

      if (result.stepUsage) {
        totalUsage = totalUsage
          ? addLanguageModelUsage(totalUsage, result.stepUsage)
          : result.stepUsage;
      }

      if (
        result.finishReason !== "tool-calls" ||
        shouldPauseForToolInteraction(
          result.responseMessage?.parts ?? pendingAssistantResponse.parts,
        )
      ) {
        break;
      }
    }

    // Close the stream immediately after generation so the UI is unblocked.
    await Promise.all([
      clearActiveStream(options.chatId, workflowRunId),
      sendFinish(writable).then(() => closeStream(writable)),
    ]);
    streamClosed = true;

    // --- Post-stream persistence & background work ---

    // Always persist the assistant message — even on abort, save content
    // from completed steps so mid-stream output is not lost.
    await persistAssistantMessage(options.chatId, pendingAssistantResponse);

    await recordWorkflowUsage(
      options.userId,
      options.modelId,
      totalUsage,
      pendingAssistantResponse,
      latestMessage.role === "assistant" ? latestMessage : undefined,
    );

    // Persist the sandbox state so lifecycle timers stay accurate.
    const sandboxState = options.agentOptions.sandbox?.state;
    if (sandboxState) {
      await persistSandboxState(options.sessionId, sandboxState);
    }

    // Auto-commit if enabled and the agent finished naturally.
    if (
      !wasAborted &&
      options.autoCommitEnabled &&
      sandboxState &&
      options.repoOwner &&
      options.repoName
    ) {
      await runAutoCommitStep({
        userId: options.userId,
        sessionId: options.sessionId,
        sessionTitle: options.sessionTitle ?? "",
        repoOwner: options.repoOwner,
        repoName: options.repoName,
        sandboxState,
      });
    }

    // Refresh the diff cache so the UI shows current changes.
    if (sandboxState) {
      await refreshDiffCache(options.sessionId, sandboxState);
    }
  } finally {
    // On unexpected errors, still clear the active stream and close
    // so the chat is never permanently marked as streaming.
    if (!streamClosed) {
      await Promise.all([
        clearActiveStream(options.chatId, workflowRunId),
        sendFinish(writable).then(() => closeStream(writable)),
      ]);
    }
  }
}

const runAgentStep = async (
  messages: ModelMessage[],
  originalMessages: WebAgentUIMessage[],
  messageId: string,
  writable: Writable,
  workflowRunId: string,
  agentOptions: OpenHarnessAgentCallOptions,
) => {
  "use step";

  const { webAgent } = await import("@/app/config");

  const abortController = new AbortController();
  const stopMonitor = startStopMonitor(workflowRunId, abortController);

  try {
    let responseMessage: WebAgentUIMessage | undefined;
    let lastStepUsage: LanguageModelUsage | undefined;
    const lastOriginalMessage = originalMessages.at(-1);
    const existingStepFinishReasons: WebAgentStepFinishMetadata[] =
      lastOriginalMessage?.role === "assistant"
        ? [...(lastOriginalMessage.metadata?.stepFinishReasons ?? [])]
        : [];
    let stepFinishReasons = existingStepFinishReasons;

    const result = await webAgent.stream({
      messages,
      options: agentOptions,
      abortSignal: abortController.signal,
    });

    for await (const part of result.toUIMessageStream<WebAgentUIMessage>({
      originalMessages,
      generateMessageId: () => messageId,
      sendStart: false,
      sendFinish: false,
      messageMetadata: ({ part: streamPart }) => {
        if (streamPart.type === "finish-step") {
          lastStepUsage = streamPart.usage;
          stepFinishReasons = [
            ...stepFinishReasons,
            {
              finishReason: streamPart.finishReason,
              rawFinishReason: streamPart.rawFinishReason,
            },
          ];
          return {
            lastStepUsage,
            totalMessageUsage: undefined,
            lastStepFinishReason: streamPart.finishReason,
            lastStepRawFinishReason: streamPart.rawFinishReason,
            stepFinishReasons,
          } satisfies WebAgentMessageMetadata;
        }
        return undefined;
      },
      onFinish: ({ responseMessage: finishedResponseMessage }) => {
        responseMessage = finishedResponseMessage;
      },
    })) {
      const writer = writable.getWriter();
      await writer.write(part);
      writer.releaseLock();
    }

    if (responseMessage == null) {
      throw new Error("Agent stream finished without a response message");
    }

    const [stepUsage, finishReason, rawFinishReason, response] =
      await Promise.all([
        result.totalUsage,
        result.finishReason,
        result.rawFinishReason,
        result.response,
      ]);

    if (finishReason === "other") {
      console.warn("[workflow] Agent step finished with reason 'other':", {
        workflowRunId,
        messageId,
        finishReason,
        rawFinishReason,
        stepUsage,
        response,
        responseMessage,
      });
    }

    return {
      responseMessage,
      responseMessages: response.messages,
      finishReason,
      rawFinishReason,
      stepUsage,
      stepWasAborted: false,
    };
  } catch (error) {
    if (isAbortError(error)) {
      const abortedFinishReason: FinishReason = "stop";
      return {
        responseMessage: undefined,
        responseMessages: [],
        finishReason: abortedFinishReason,
        rawFinishReason: undefined,
        stepUsage: undefined,
        stepWasAborted: true,
      };
    }

    throw error;
  } finally {
    stopMonitor.stop();
    await stopMonitor.done;
  }
};

function startStopMonitor(runId: string, abortController: AbortController) {
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

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function sendStart(writable: Writable, messageId: string) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "start", messageId });
  } finally {
    writer.releaseLock();
  }
}

async function sendFinish(writable: Writable) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "finish", finishReason: "stop" });
  } finally {
    writer.releaseLock();
  }
}

async function closeStream(writable: Writable) {
  "use step";
  await writable.close();
}
