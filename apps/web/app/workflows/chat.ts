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
import type { OpenAgentCallOptions } from "@open-agents/agent";
import { getWorkflowMetadata, getWritable } from "workflow";
import { getRun } from "workflow/api";
import { assistantFileLinkPrompt } from "@/lib/assistant-file-links";
import { addLanguageModelUsage } from "./usage-utils";
import { extractGatewayCost } from "./gateway-metadata";
import type {
  WebAgentCommitData,
  WebAgentCommitDataPart,
  WebAgentMessageMetadata,
  WebAgentPrData,
  WebAgentPrDataPart,
  WebAgentStepFinishMetadata,
  WebAgentUIMessage,
} from "@/app/types";
import {
  claimActiveStream,
  closeStream,
  clearActiveStream,
  hasAutoCommitChangesStep,
  persistAssistantMessage,
  persistAssistantMessageWithToolResults,
  persistSandboxState,
  persistUserMessage,
  recordWorkflowUsage,
  refreshDiffCache,
  refreshLifecycleActivity,
  runAutoCommitStep,
  runAutoCreatePrStep,
  sendFinish,
} from "./chat-post-finish";
import { dedupeMessageReasoning } from "@/lib/chat/dedupe-message-reasoning";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import {
  filterModelVariantsForSession,
  sanitizeSelectedModelIdForSession,
  sanitizeUserPreferencesForSession,
} from "@/lib/model-access";
import { getAllVariants } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import type { Session as AuthSession } from "@/lib/session/types";
import type {
  WorkflowRunStatus,
  WorkflowRunStepTiming,
} from "@/lib/db/workflow-runs";
import { resolveChatModelSelection } from "../api/chat/_lib/model-selection";
import { resolveChatSandboxRuntime } from "./chat-sandbox-runtime";

type AuthSessionContext = Pick<AuthSession, "authProvider" | "user"> | null;

type Options = {
  messages: WebAgentUIMessage[];
  chatId: string;
  sessionId: string;
  userId: string;
  requestUrl: string;
  authSession: AuthSessionContext;
  selectedModelId?: string;
  modelId?: string;
  agentOptions?: Omit<OpenAgentCallOptions, "sandbox" | "skills">;
  maxSteps?: number;
  autoCommitEnabled?: boolean;
  autoCreatePrEnabled?: boolean;
};

type ChatModelRuntime = {
  selectedModelId: string;
  modelId: string;
  agentOptions: Omit<OpenAgentCallOptions, "sandbox" | "skills">;
  autoCommitEnabled: boolean;
  autoCreatePrEnabled: boolean;
};

type Writable = WritableStream<UIMessageChunk>;

const shouldPauseForToolInteraction = (parts: WebAgentUIMessage["parts"]) =>
  parts.some(
    (part) =>
      isToolUIPart(part) &&
      (part.state === "input-available" || part.state === "approval-requested"),
  );

const DIFF_REFRESHING_TOOL_TYPES = new Set([
  "tool-write",
  "tool-edit",
  "tool-bash",
]);

function shouldRefreshDiffCacheForParts(
  parts: WebAgentUIMessage["parts"],
): boolean {
  return parts.some(
    (part) =>
      isToolUIPart(part) &&
      DIFF_REFRESHING_TOOL_TYPES.has(part.type) &&
      (part.state === "output-available" || part.state === "output-error"),
  );
}

const convertMessages = async (
  messages: WebAgentUIMessage[],
): Promise<ModelMessage[]> => {
  "use step";
  const { webAgent } = await import("@/app/config");
  const dedupedMessages = messages.map(dedupeMessageReasoning);
  const modelMessages = await convertToModelMessages<WebAgentUIMessage>(
    dedupedMessages,
    {
      ignoreIncompleteToolCalls: true,
      tools: webAgent.tools,
      convertDataPart: (part) => {
        if (part.type === "data-snippet") {
          const { filename, content } = part.data;
          return {
            type: "text",
            text: JSON.stringify({ type: "snippet", filename, content }),
          };
        }
        return undefined;
      },
    },
  );

  return pruneMessages({
    messages: modelMessages,
    emptyMessages: "remove",
  });
};

async function resolveChatModelRuntime(params: {
  userId: string;
  sessionId: string;
  chatId: string;
  requestUrl: string;
  authSession: AuthSessionContext;
}): Promise<ChatModelRuntime> {
  "use step";

  const [sessionRecord, chat, rawPreferences] = await Promise.all([
    getSessionById(params.sessionId),
    getChatById(params.chatId),
    getUserPreferences(params.userId).catch((error) => {
      console.error("Failed to load user preferences:", error);
      return null;
    }),
  ]);

  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (!chat || chat.sessionId !== params.sessionId) {
    throw new Error("Chat not found");
  }

  const preferences = rawPreferences
    ? sanitizeUserPreferencesForSession(
        rawPreferences,
        params.authSession,
        params.requestUrl,
      )
    : null;
  const modelVariants = filterModelVariantsForSession(
    getAllVariants(preferences?.modelVariants ?? []),
    params.authSession,
    params.requestUrl,
  );
  const selectedModelId =
    sanitizeSelectedModelIdForSession(
      chat.modelId,
      modelVariants,
      params.authSession,
      params.requestUrl,
    ) ??
    chat.modelId ??
    null;
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: sanitizeSelectedModelIdForSession(
          preferences.defaultSubagentModelId,
          modelVariants,
          params.authSession,
          params.requestUrl,
        ),
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;
  const autoCommitEnabled =
    (sessionRecord.autoCommitPushOverride ??
      preferences?.autoCommitPush ??
      false) &&
    Boolean(sessionRecord.repoOwner && sessionRecord.repoName);
  const autoCreatePrEnabled =
    autoCommitEnabled &&
    (sessionRecord.autoCreatePrOverride ?? preferences?.autoCreatePr ?? false);

  return {
    selectedModelId: selectedModelId ?? mainModelSelection.id,
    modelId: mainModelSelection.id,
    agentOptions: {
      model: mainModelSelection,
      ...(subagentModelSelection
        ? { subagentModel: subagentModelSelection }
        : {}),
      customInstructions: assistantFileLinkPrompt,
    },
    autoCommitEnabled,
    autoCreatePrEnabled,
  };
}

const generateId = async () => {
  "use step";
  return generateIdAi();
};

async function persistInputMessages(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  "use step";

  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return;
  }

  await Promise.all([
    persistUserMessage(chatId, latestMessage),
    persistAssistantMessageWithToolResults(chatId, latestMessage),
  ]);
}

function buildStepTiming(
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

function withModelMetadata(
  metadata: WebAgentMessageMetadata | undefined,
  selectedModelId: string,
  modelId: string,
): WebAgentMessageMetadata {
  return {
    ...metadata,
    selectedModelId,
    modelId,
  };
}

function getSetupErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Workspace setup failed. Try again in a moment.";
  }

  if (error.message.includes("Connect GitHub")) {
    return "Connect GitHub to access this repository, then try again.";
  }

  if (error.message === "Session is archived") {
    return "This session is archived. Unarchive it to continue.";
  }

  return "Workspace setup failed. Try again in a moment.";
}

function isStepTimingError(
  error: unknown,
): error is Error & { stepTiming: WorkflowRunStepTiming } {
  return (
    error instanceof Error &&
    "stepTiming" in error &&
    typeof error.stepTiming === "object" &&
    error.stepTiming !== null
  );
}

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
  part: WebAgentCommitDataPart | WebAgentPrDataPart,
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
  part: WebAgentCommitDataPart | WebAgentPrDataPart,
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

  // Self-register this workflow's runId onto the chat as the very first step.
  // The HTTP POST handler also writes this (via compareAndSetChatActiveStreamId
  // after `start()` returns), but that write is best-effort and can be lost
  // when the client disconnects early and the function is torn down before
  // it runs. Persisting from inside the workflow guarantees that as long as
  // the workflow is running, the chat row points at it and the client can
  // resume on refresh.
  const activeStreamClaim = await claimActiveStream(
    options.chatId,
    workflowRunId,
  );
  if (activeStreamClaim === "conflict") {
    // Another workflow claimed the slot while this run was queued or starting.
    // Exit before emitting chunks or persisting messages so only the owning
    // workflow can mutate this chat.
    await closeStream(writable);
    return;
  }

  const modelMessagesPromise = convertMessages(options.messages);
  const inputMessagesPersistPromise = persistInputMessages(
    options.chatId,
    options.messages,
  );
  const assistantId =
    latestMessage.role === "assistant" ? latestMessage.id : await generateId();
  let selectedModelId = APP_DEFAULT_MODEL_ID;
  let modelId = APP_DEFAULT_MODEL_ID;

  let pendingAssistantResponse: WebAgentUIMessage =
    latestMessage.role === "assistant"
      ? {
          ...latestMessage,
          metadata: withModelMetadata(
            latestMessage.metadata,
            selectedModelId,
            modelId,
          ),
          parts: [...latestMessage.parts],
        }
      : {
          role: "assistant",
          id: assistantId,
          parts: [],
          metadata: withModelMetadata(undefined, selectedModelId, modelId),
        };

  let originalMessagesForStep: WebAgentUIMessage[] = [latestMessage];

  const runStartedAt = new Date();
  const previousResponseMessage =
    latestMessage.role === "assistant" ? latestMessage : undefined;
  const stepTimings: WorkflowRunStepTiming[] = [];
  let wasAborted = false;
  let exhaustedMaxSteps = false;
  let totalUsage: LanguageModelUsage | undefined;
  let finalFinishReason: FinishReason | undefined;
  let streamClosed = false;
  let workflowStatus: WorkflowRunStatus = "completed";
  let caughtError: unknown;
  let sandboxState: OpenAgentCallOptions["sandbox"]["state"] | undefined;
  let shouldRefreshCachedDiff = false;

  try {
    const [runtime, modelRuntime, modelMessages] = await Promise.all([
      resolveChatSandboxRuntime({
        userId: options.userId,
        sessionId: options.sessionId,
        assistantId,
      }),
      resolveChatModelRuntime({
        userId: options.userId,
        sessionId: options.sessionId,
        chatId: options.chatId,
        requestUrl: options.requestUrl,
        authSession: options.authSession,
      }),
      modelMessagesPromise,
      inputMessagesPersistPromise,
    ]);
    selectedModelId = options.selectedModelId ?? modelRuntime.selectedModelId;
    modelId = options.modelId ?? modelRuntime.modelId;
    pendingAssistantResponse = {
      ...pendingAssistantResponse,
      metadata: withModelMetadata(
        pendingAssistantResponse.metadata,
        selectedModelId,
        modelId,
      ),
    };

    const agentOptions: OpenAgentCallOptions = {
      ...modelRuntime.agentOptions,
      ...options.agentOptions,
      sandbox: {
        state: runtime.sandboxState,
        workingDirectory: runtime.workingDirectory,
        currentBranch: runtime.currentBranch,
        environmentDetails: runtime.environmentDetails,
      },
      ...(runtime.skills.length > 0 ? { skills: runtime.skills } : {}),
    };
    sandboxState = runtime.sandboxState;

    for (
      let step = 0;
      options.maxSteps === undefined || step < options.maxSteps;
      step++
    ) {
      let result: Awaited<ReturnType<typeof runAgentStep>>;

      try {
        result = await runAgentStep(
          modelMessages,
          originalMessagesForStep,
          assistantId,
          writable,
          workflowRunId,
          options.chatId,
          options.sessionId,
          selectedModelId,
          modelId,
          agentOptions,
          step + 1,
        );
      } catch (error) {
        if (isStepTimingError(error)) {
          stepTimings.push(error.stepTiming);
        }
        throw error;
      }

      stepTimings.push(result.stepTiming);
      pendingAssistantResponse =
        result.responseMessage ?? pendingAssistantResponse;
      shouldRefreshCachedDiff =
        shouldRefreshCachedDiff ||
        shouldRefreshDiffCacheForParts(pendingAssistantResponse.parts);
      originalMessagesForStep = [pendingAssistantResponse];
      modelMessages.push(...result.responseMessages);
      wasAborted = wasAborted || result.stepWasAborted;
      finalFinishReason = result.finishReason;

      if (result.stepUsage) {
        totalUsage = totalUsage
          ? addLanguageModelUsage(totalUsage, result.stepUsage)
          : result.stepUsage;
      }

      const shouldContinue =
        result.finishReason === "tool-calls" &&
        !shouldPauseForToolInteraction(
          result.responseMessage?.parts ?? pendingAssistantResponse.parts,
        );

      if (!shouldContinue) {
        break;
      }

      if (options.maxSteps !== undefined && step + 1 >= options.maxSteps) {
        exhaustedMaxSteps = true;
        break;
      }
    }

    if (sandboxState) {
      await refreshLifecycleActivity(options.sessionId);
    }

    if (totalUsage) {
      pendingAssistantResponse = {
        ...pendingAssistantResponse,
        metadata: {
          ...pendingAssistantResponse.metadata,
          totalMessageUsage: totalUsage,
        },
      };
    }

    // Persist completed model output before post-finish work so it is not lost
    // if later automation fails. Sandbox state can persist in parallel.
    await Promise.all([
      persistAssistantMessage(options.chatId, pendingAssistantResponse),
      ...(sandboxState
        ? [persistSandboxState(options.sessionId, sandboxState)]
        : []),
    ]);

    const finishedNaturally =
      !wasAborted &&
      finalFinishReason !== undefined &&
      finalFinishReason !== "tool-calls";
    const commitPartId = `${assistantId}:commit`;
    const prPartId = `${assistantId}:pr`;
    const repoOwner = runtime.repoOwner;
    const repoName = runtime.repoName;
    let didUpdateGitData = false;

    let autoCommitResult: Awaited<ReturnType<typeof runAutoCommitStep>> | null =
      null;

    const canAutoCommit =
      finishedNaturally &&
      (options.autoCommitEnabled ?? modelRuntime.autoCommitEnabled) &&
      sandboxState != null &&
      repoOwner != null &&
      repoName != null;

    if (canAutoCommit) {
      const hasAutoCommitChanges = await hasAutoCommitChangesStep({
        sandboxState,
      });

      if (hasAutoCommitChanges) {
        const pendingCommitPart: WebAgentCommitDataPart = {
          type: "data-commit",
          id: commitPartId,
          data: { status: "pending" },
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          pendingCommitPart,
        );
        await sendDataPart(writable, pendingCommitPart);
        autoCommitResult = await runAutoCommitStep({
          userId: options.userId,
          sessionId: options.sessionId,
          sessionTitle: runtime.sessionTitle,
          repoOwner,
          repoName,
          sandboxState,
        });

        const resolvedCommitPart: WebAgentCommitDataPart = {
          type: "data-commit",
          id: commitPartId,
          data: buildCommitData(autoCommitResult, repoOwner, repoName),
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          resolvedCommitPart,
        );
        await sendDataPart(writable, resolvedCommitPart);
        didUpdateGitData = true;
        shouldRefreshCachedDiff = true;
      } else {
        autoCommitResult = {
          committed: false,
          pushed: false,
        };
      }
    }

    const canAutoCreatePr =
      autoCommitResult != null &&
      !autoCommitResult.error &&
      (autoCommitResult.pushed || !autoCommitResult.committed);

    if (
      canAutoCommit &&
      (options.autoCreatePrEnabled ?? modelRuntime.autoCreatePrEnabled)
    ) {
      if (canAutoCreatePr) {
        const pendingPrPart: WebAgentPrDataPart = {
          type: "data-pr",
          id: prPartId,
          data: { status: "pending" },
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          pendingPrPart,
        );
        await sendDataPart(writable, pendingPrPart);
        const autoPrResult = await runAutoCreatePrStep({
          userId: options.userId,
          sessionId: options.sessionId,
          sessionTitle: runtime.sessionTitle,
          repoOwner,
          repoName,
          sandboxState,
        });

        const resolvedPrPart: WebAgentPrDataPart = {
          type: "data-pr",
          id: prPartId,
          data: buildPrData(autoPrResult),
        };
        pendingAssistantResponse = upsertAssistantDataPart(
          pendingAssistantResponse,
          resolvedPrPart,
        );
        await sendDataPart(writable, resolvedPrPart);
        didUpdateGitData = true;
        shouldRefreshCachedDiff = true;
      } else {
        const skippedPrPart: WebAgentPrDataPart = {
          type: "data-pr",
          id: prPartId,
          data: {
            status: "skipped",
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
      ...(sandboxState && shouldRefreshCachedDiff
        ? [refreshDiffCache(options.sessionId, sandboxState)]
        : []),
    ]);
    streamClosed = true;

    workflowStatus = wasAborted
      ? "aborted"
      : exhaustedMaxSteps
        ? "failed"
        : "completed";
  } catch (error) {
    workflowStatus = wasAborted ? "aborted" : "failed";
    caughtError = error;

    if (pendingAssistantResponse.parts.length === 0 && !streamClosed) {
      const errorText = getSetupErrorMessage(error);
      pendingAssistantResponse = {
        ...pendingAssistantResponse,
        parts: [{ type: "text", text: errorText }],
      };
      await sendTextMessage(writable, "setup-error", errorText);
      await persistAssistantMessage(options.chatId, pendingAssistantResponse);
    }
  } finally {
    try {
      // On unexpected errors, still clear the active stream and close
      // so the chat is never permanently marked as streaming.
      if (!streamClosed) {
        await Promise.all([
          clearActiveStream(options.chatId, workflowRunId),
          sendFinish(writable).then(() => closeStream(writable)),
        ]);
      }
    } finally {
      const runFinishedAt = new Date();
      await recordWorkflowUsage(
        options.userId,
        modelId,
        totalUsage,
        pendingAssistantResponse,
        previousResponseMessage,
        {
          workflowRunId,
          chatId: options.chatId,
          sessionId: options.sessionId,
          status: workflowStatus,
          startedAt: runStartedAt.toISOString(),
          finishedAt: runFinishedAt.toISOString(),
          totalDurationMs: runFinishedAt.getTime() - runStartedAt.getTime(),
          stepTimings,
        },
      );
    }
  }

  if (caughtError) {
    throw caughtError;
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
  modelId: string,
  agentOptions: OpenAgentCallOptions,
  stepNumber: number,
) => {
  "use step";

  const stepStartedAt = new Date();
  const { webAgent } = await import("@/app/config");

  const abortController = new AbortController();
  const stopMonitor = startStopMonitor(workflowRunId, abortController);

  try {
    let responseMessage: WebAgentUIMessage | undefined;
    let lastStepUsage: LanguageModelUsage | undefined;
    let lastStepCost: number | undefined;
    const lastOriginalMessage = originalMessages.at(-1);
    const existingStepFinishReasons: WebAgentStepFinishMetadata[] =
      lastOriginalMessage?.role === "assistant"
        ? [...(lastOriginalMessage.metadata?.stepFinishReasons ?? [])]
        : [];
    const existingTotalMessageUsage =
      lastOriginalMessage?.role === "assistant"
        ? lastOriginalMessage.metadata?.totalMessageUsage
        : undefined;
    const existingTotalMessageCost =
      lastOriginalMessage?.role === "assistant"
        ? lastOriginalMessage.metadata?.totalMessageCost
        : undefined;
    let stepFinishReasons = existingStepFinishReasons;
    let totalMessageUsage = existingTotalMessageUsage;
    let totalMessageCost = existingTotalMessageCost;

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
          if (streamPart.usage) {
            totalMessageUsage = totalMessageUsage
              ? addLanguageModelUsage(totalMessageUsage, streamPart.usage)
              : streamPart.usage;
          }
          const stepCost = extractGatewayCost(streamPart.providerMetadata);
          if (stepCost !== undefined) {
            lastStepCost = stepCost;
            totalMessageCost = (totalMessageCost ?? 0) + stepCost;
          }
          stepFinishReasons = [
            ...stepFinishReasons,
            {
              finishReason: streamPart.finishReason,
              rawFinishReason: streamPart.rawFinishReason,
            },
          ];
          return {
            selectedModelId,
            modelId,
            lastStepUsage,
            totalMessageUsage,
            lastStepCost,
            totalMessageCost,
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

    responseMessage = {
      ...responseMessage,
      metadata: withModelMetadata(
        responseMessage.metadata,
        selectedModelId,
        modelId,
      ),
    };

    const [stepUsage, finishReason, rawFinishReason, response, steps] =
      await Promise.all([
        result.totalUsage,
        result.finishReason,
        result.rawFinishReason,
        result.response,
        result.steps,
      ]);

    if (stepUsage) {
      responseMessage = {
        ...responseMessage,
        metadata: {
          ...responseMessage.metadata,
          totalMessageUsage: existingTotalMessageUsage
            ? addLanguageModelUsage(existingTotalMessageUsage, stepUsage)
            : stepUsage,
        },
      };
    }

    const stepsCost = steps.reduce<number | undefined>((sum, step) => {
      const cost = extractGatewayCost(step.providerMetadata);
      if (cost === undefined) {
        return sum;
      }
      return (sum ?? 0) + cost;
    }, undefined);

    if (stepsCost !== undefined) {
      const carriedCost = (existingTotalMessageCost ?? 0) + stepsCost;
      responseMessage = {
        ...responseMessage,
        metadata: {
          ...responseMessage.metadata,
          lastStepCost,
          totalMessageCost: carriedCost,
        },
      };
    }

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
        modelId,
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

    const stepFinishedAt = new Date();

    return {
      responseMessage,
      responseMessages: response.messages,
      finishReason,
      rawFinishReason,
      stepUsage,
      stepCost: stepsCost,
      stepWasAborted: false,
      stepTiming: buildStepTiming(
        stepNumber,
        stepStartedAt,
        stepFinishedAt,
        finishReason,
        rawFinishReason,
      ),
    };
  } catch (error) {
    const stepFinishedAt = new Date();

    if (isAbortError(error)) {
      const abortedFinishReason: FinishReason = "stop";
      return {
        responseMessage: undefined,
        responseMessages: [],
        finishReason: abortedFinishReason,
        rawFinishReason: undefined,
        stepUsage: undefined,
        stepCost: undefined,
        stepWasAborted: true,
        stepTiming: buildStepTiming(
          stepNumber,
          stepStartedAt,
          stepFinishedAt,
          abortedFinishReason,
        ),
      };
    }

    const errorWithStepTiming =
      error instanceof Error ? error : new Error(String(error));
    Object.assign(errorWithStepTiming, {
      stepTiming: buildStepTiming(
        stepNumber,
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

async function sendTextMessage(writable: Writable, id: string, text: string) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "text-start", id });
    await writer.write({ type: "text-delta", id, delta: text });
    await writer.write({ type: "text-end", id });
  } finally {
    writer.releaseLock();
  }
}
