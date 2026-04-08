import {
  convertToModelMessages,
  type FinishReason,
  generateId as generateIdAi,
  isToolUIPart,
  type LanguageModelUsage,
  type ModelMessage,
  pruneMessages,
  type UIMessageChunk,
} from "ai";
import type { OpenHarnessAgentCallOptions } from "@open-harness/agent";
import { getWorkflowMetadata, getWritable } from "workflow";
import { getRun } from "workflow/api";
import { addLanguageModelUsage } from "./usage-utils";
import type {
  WebAgentCommitData,
  WebAgentMessageMetadata,
  WebAgentPrData,
  WebAgentStepFinishMetadata,
  WebAgentUIMessage,
} from "@/app/types";
import {
  clearActiveStream,
  persistAssistantMessage,
  persistSandboxState,
  recordWorkflowUsage,
  refreshDiffCache,
  refreshLifecycleActivity,
  runAutoCommitStep,
  runAutoCreatePrStep,
} from "./chat-post-finish";
import { dedupeMessageReasoning } from "@/lib/chat/dedupe-message-reasoning";

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
  /** Whether auto PR creation should run after auto-commit on a natural finish. */
  autoCreatePrEnabled?: boolean;
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
  const dedupedMessages = messages.map(dedupeMessageReasoning);
  const modelMessages = await convertToModelMessages(dedupedMessages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
    convertDataPart: () => undefined,
  });

  return pruneMessages({
    messages: modelMessages,
    emptyMessages: "remove",
  });
};

const generateId = async () => {
  "use step";
  return generateIdAi();
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function summarizeContentTypes(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.slice(0, 8).map((part) => {
      if (isObjectRecord(part) && typeof part.type === "string") {
        return part.type;
      }

      return typeof part;
    });
  }

  if (typeof content === "string") {
    return ["text"];
  }

  if (content === undefined) {
    return undefined;
  }

  return [typeof content];
}

function summarizeRequestTool(tool: unknown): unknown {
  if (!isObjectRecord(tool)) {
    return tool === undefined ? undefined : { type: typeof tool };
  }

  return compactRecord({
    type: typeof tool.type === "string" ? tool.type : undefined,
    name: typeof tool.name === "string" ? tool.name : undefined,
    strict: typeof tool.strict === "boolean" ? tool.strict : undefined,
  });
}

function summarizeRequestInputItem(item: unknown): unknown {
  if (!isObjectRecord(item)) {
    return { type: typeof item };
  }

  return compactRecord({
    type:
      typeof item.type === "string"
        ? item.type
        : typeof item.role === "string"
          ? "message"
          : undefined,
    role: typeof item.role === "string" ? item.role : undefined,
    contentTypes: summarizeContentTypes(item.content),
  });
}

function summarizeRequestBody(body: unknown): unknown {
  if (!isObjectRecord(body)) {
    return body === undefined ? undefined : { type: typeof body };
  }

  const input = Array.isArray(body.input) ? body.input : undefined;
  const tools = Array.isArray(body.tools) ? body.tools : undefined;

  return compactRecord({
    model: typeof body.model === "string" ? body.model : undefined,
    stream: typeof body.stream === "boolean" ? body.stream : undefined,
    store: typeof body.store === "boolean" ? body.store : undefined,
    previousResponseId:
      typeof body.previous_response_id === "string"
        ? body.previous_response_id
        : undefined,
    maxOutputTokens:
      typeof body.max_output_tokens === "number"
        ? body.max_output_tokens
        : undefined,
    maxCompletionTokens:
      typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : undefined,
    temperature:
      typeof body.temperature === "number" ? body.temperature : undefined,
    topP: typeof body.top_p === "number" ? body.top_p : undefined,
    truncation:
      typeof body.truncation === "string" ? body.truncation : undefined,
    toolChoice: body.tool_choice,
    parallelToolCalls:
      typeof body.parallel_tool_calls === "boolean"
        ? body.parallel_tool_calls
        : undefined,
    reasoning: isObjectRecord(body.reasoning) ? body.reasoning : undefined,
    text: isObjectRecord(body.text) ? body.text : undefined,
    include: Array.isArray(body.include) ? body.include : undefined,
    inputCount: input?.length,
    inputSummary: input?.slice(0, 6).map(summarizeRequestInputItem),
    toolsCount: tools?.length,
    tools: tools?.slice(0, 6).map(summarizeRequestTool),
  });
}

function summarizeResponseOutputItem(item: unknown): unknown {
  if (!isObjectRecord(item)) {
    return { type: typeof item };
  }

  return compactRecord({
    type: typeof item.type === "string" ? item.type : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    role: typeof item.role === "string" ? item.role : undefined,
    id: typeof item.id === "string" ? item.id : undefined,
    contentTypes: summarizeContentTypes(item.content),
  });
}

function summarizeResponseBody(body: unknown): unknown {
  if (!isObjectRecord(body)) {
    return body === undefined ? undefined : { type: typeof body };
  }

  const output = Array.isArray(body.output) ? body.output : undefined;

  return compactRecord({
    id: typeof body.id === "string" ? body.id : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    incompleteDetails: isObjectRecord(body.incomplete_details)
      ? body.incomplete_details
      : undefined,
    error: body.error,
    outputCount: output?.length,
    outputSummary: output?.slice(0, 8).map(summarizeResponseOutputItem),
    usage: isObjectRecord(body.usage) ? body.usage : undefined,
    serviceTier:
      typeof body.service_tier === "string" ? body.service_tier : undefined,
  });
}

function stringifyDebugPayload(value: unknown): string {
  const seen = new WeakSet<object>();

  return (
    JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "bigint") {
          return currentValue.toString();
        }

        if (typeof currentValue === "object" && currentValue !== null) {
          if (seen.has(currentValue)) {
            return "[Circular]";
          }

          seen.add(currentValue);
        }

        return currentValue;
      },
      2,
    ) ?? "undefined"
  );
}

function buildGitHubCommitUrl(
  repoOwner: string,
  repoName: string,
  commitSha: string,
): string {
  return `https://github.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/commit/${encodeURIComponent(commitSha)}`;
}

function buildCommitData(
  result: Awaited<ReturnType<typeof runAutoCommitStep>>,
  repoOwner: string,
  repoName: string,
): WebAgentCommitData {
  if (result.error) {
    return {
      status: "error",
      committed: result.committed,
      pushed: result.pushed,
      commitMessage: result.commitMessage,
      commitSha: result.commitSha,
      url:
        result.pushed && result.commitSha
          ? buildGitHubCommitUrl(repoOwner, repoName, result.commitSha)
          : undefined,
      error: result.error,
    };
  }

  if (result.committed) {
    return {
      status: "success",
      committed: result.committed,
      pushed: result.pushed,
      commitMessage: result.commitMessage,
      commitSha: result.commitSha,
      url:
        result.pushed && result.commitSha
          ? buildGitHubCommitUrl(repoOwner, repoName, result.commitSha)
          : undefined,
    };
  }

  return {
    status: "skipped",
    committed: false,
    pushed: false,
  };
}

function buildPrData(
  result: Awaited<ReturnType<typeof runAutoCreatePrStep>>,
): WebAgentPrData {
  if (result.error) {
    return {
      status: "error",
      created: result.created,
      syncedExisting: result.syncedExisting,
      prNumber: result.prNumber,
      url: result.prUrl,
      error: result.error,
    };
  }

  if (result.skipped) {
    return {
      status: "skipped",
      created: result.created,
      syncedExisting: result.syncedExisting,
      prNumber: result.prNumber,
      url: result.prUrl,
      skipReason: result.skipReason,
    };
  }

  return {
    status: "success",
    created: result.created,
    syncedExisting: result.syncedExisting,
    prNumber: result.prNumber,
    url: result.prUrl,
  };
}

function upsertAssistantDataPart(
  message: WebAgentUIMessage,
  part:
    | {
        type: "data-commit";
        id: string;
        data: WebAgentCommitData;
      }
    | {
        type: "data-pr";
        id: string;
        data: WebAgentPrData;
      },
): WebAgentUIMessage {
  const nextParts = [...message.parts];
  const existingIndex = nextParts.findIndex(
    (messagePart) =>
      messagePart.type === part.type && messagePart.id === part.id,
  );

  if (existingIndex >= 0) {
    nextParts[existingIndex] = part;
  } else {
    nextParts.push(part);
  }

  return {
    ...message,
    parts: nextParts,
  };
}

async function sendDataPart(
  writable: Writable,
  part:
    | {
        type: "data-commit";
        id: string;
        data: WebAgentCommitData;
      }
    | {
        type: "data-pr";
        id: string;
        data: WebAgentPrData;
      },
) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write(part);
  } finally {
    writer.releaseLock();
  }
}

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
  let finalFinishReason: FinishReason | undefined;
  let streamClosed = false;
  const sandboxState = options.agentOptions.sandbox?.state;

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
        options.chatId,
        options.sessionId,
        options.modelId,
        options.agentOptions,
      );

      pendingAssistantResponse =
        result.responseMessage ?? pendingAssistantResponse;
      originalMessagesForStep = [pendingAssistantResponse];
      modelMessages.push(...result.responseMessages);
      wasAborted = wasAborted || result.stepWasAborted;
      finalFinishReason = result.finishReason;

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

    if (sandboxState) {
      await refreshLifecycleActivity(options.sessionId);
    }

    // Persist the assistant message immediately so completed model output is not
    // lost if later post-finish work fails.
    await persistAssistantMessage(options.chatId, pendingAssistantResponse);

    await recordWorkflowUsage(
      options.userId,
      options.modelId,
      totalUsage,
      pendingAssistantResponse,
      latestMessage.role === "assistant" ? latestMessage : undefined,
    );

    // Persist the sandbox state so lifecycle timers stay accurate.
    if (sandboxState) {
      await persistSandboxState(options.sessionId, sandboxState);
    }

    const finishedNaturally =
      !wasAborted &&
      finalFinishReason !== undefined &&
      finalFinishReason !== "tool-calls";
    const commitPartId = `${assistantId}:commit`;
    const prPartId = `${assistantId}:pr`;
    const repoOwner = options.repoOwner;
    const repoName = options.repoName;
    let didUpdateGitData = false;

    let autoCommitResult: Awaited<ReturnType<typeof runAutoCommitStep>> | null =
      null;

    const canAutoCommit =
      finishedNaturally &&
      options.autoCommitEnabled &&
      sandboxState != null &&
      repoOwner != null &&
      repoName != null;

    if (canAutoCommit) {
      const pendingCommitPart = {
        type: "data-commit" as const,
        id: commitPartId,
        data: { status: "pending" as const },
      };
      pendingAssistantResponse = upsertAssistantDataPart(
        pendingAssistantResponse,
        pendingCommitPart,
      );
      await sendDataPart(writable, pendingCommitPart);
      didUpdateGitData = true;

      autoCommitResult = await runAutoCommitStep({
        userId: options.userId,
        sessionId: options.sessionId,
        sessionTitle: options.sessionTitle ?? "",
        repoOwner,
        repoName,
        sandboxState,
      });

      const resolvedCommitPart = {
        type: "data-commit" as const,
        id: commitPartId,
        data: buildCommitData(autoCommitResult, repoOwner, repoName),
      };
      pendingAssistantResponse = upsertAssistantDataPart(
        pendingAssistantResponse,
        resolvedCommitPart,
      );
      await sendDataPart(writable, resolvedCommitPart);
    }

    const canAutoCreatePr =
      autoCommitResult != null &&
      !autoCommitResult.error &&
      (autoCommitResult.pushed || !autoCommitResult.committed);

    if (canAutoCommit && options.autoCreatePrEnabled) {
      if (canAutoCreatePr) {
        const pendingPrPart = {
          type: "data-pr" as const,
          id: prPartId,
          data: { status: "pending" as const },
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          pendingPrPart,
        );
        await sendDataPart(writable, pendingPrPart);
        didUpdateGitData = true;

        const autoPrResult = await runAutoCreatePrStep({
          userId: options.userId,
          sessionId: options.sessionId,
          sessionTitle: options.sessionTitle ?? "",
          repoOwner,
          repoName,
          sandboxState,
        });

        const resolvedPrPart = {
          type: "data-pr" as const,
          id: prPartId,
          data: buildPrData(autoPrResult),
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          resolvedPrPart,
        );
        await sendDataPart(writable, resolvedPrPart);
      } else {
        const skippedPrPart = {
          type: "data-pr" as const,
          id: prPartId,
          data: {
            status: "skipped" as const,
            skipReason:
              autoCommitResult?.error ??
              "Auto-commit did not leave origin in sync with HEAD",
          },
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          skippedPrPart,
        );
        await sendDataPart(writable, skippedPrPart);
        didUpdateGitData = true;
      }
    }

    if (didUpdateGitData) {
      await persistAssistantMessage(options.chatId, pendingAssistantResponse);
    }

    await Promise.all([
      clearActiveStream(options.chatId, workflowRunId),
      sendFinish(writable).then(() => closeStream(writable)),
    ]);
    streamClosed = true;

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
  chatId: string,
  sessionId: string,
  selectedModelId: string,
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

    const [stepUsage, finishReason, rawFinishReason, response, steps] =
      await Promise.all([
        result.totalUsage,
        result.finishReason,
        result.rawFinishReason,
        result.response,
        result.steps,
      ]);

    if (finishReason === "other") {
      const stepDiagnostics = steps.map((step) => ({
        stepNumber: step.stepNumber,
        model: step.model,
        finishReason: step.finishReason,
        rawFinishReason: step.rawFinishReason,
        usage: step.usage,
        warnings: step.warnings,
        contentTypes: step.content.map((contentPart) => contentPart.type),
        toolCalls: step.toolCalls.map((toolCall) =>
          compactRecord({
            toolName: toolCall.toolName,
            dynamic: toolCall.dynamic,
            invalid: "invalid" in toolCall ? toolCall.invalid : undefined,
            providerExecuted: toolCall.providerExecuted,
          }),
        ),
        toolResults: step.toolResults.map((toolResult) =>
          compactRecord({
            toolName: toolResult.toolName,
            dynamic: toolResult.dynamic,
            preliminary: toolResult.preliminary,
            providerExecuted: toolResult.providerExecuted,
          }),
        ),
        request: compactRecord({
          body: summarizeRequestBody(step.request.body),
        }),
        response: compactRecord({
          id: step.response.id,
          modelId: step.response.modelId,
          timestamp: step.response.timestamp.toISOString(),
          headers: step.response.headers,
          body: summarizeResponseBody(step.response.body),
          messageCount: step.response.messages.length,
        }),
        providerMetadata: step.providerMetadata,
      }));

      const debugPayload = stringifyDebugPayload({
        workflowRunId,
        chatId,
        sessionId,
        messageId,
        selectedModelId,
        finishReason,
        rawFinishReason,
        stepUsage,
        response,
        responseMessage,
        stepDiagnostics,
      });

      console.warn(
        `[workflow] Agent step finished with reason 'other':\n${debugPayload}`,
      );
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
