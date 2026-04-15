import type { LanguageModelUsage } from "ai";
import type { SandboxState, Sandbox } from "@open-harness/sandbox";
import type { WebAgentUIMessage } from "@/app/types";
import type { AutoCommitResult } from "@/lib/chat/auto-commit-direct";
import type { AutoCreatePrResult } from "@/lib/chat/auto-pr-direct";
import {
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  touchChat,
  updateChat,
  updateSession,
  isFirstChatMessage,
  upsertChatMessageScoped,
  updateChatAssistantActivity,
} from "@/lib/db/sessions";
import {
  buildActiveLifecycleUpdate,
  buildLifecycleActivityUpdate,
} from "@/lib/sandbox/lifecycle";
import { dedupeMessageReasoning } from "@/lib/chat/dedupe-message-reasoning";
import {
  recordWorkflowRun,
  type WorkflowRunStatus,
  type WorkflowRunStepTiming,
} from "@/lib/db/workflow-runs";
import { recordUsage } from "@/lib/db/usage";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

type UsageByModel = {
  usage: LanguageModelUsage;
  toolCallCount: number;
};

function filterNewTaskUsageEvents<T extends { toolCallId?: string }>(
  currentEvents: T[],
  baselineEvents: T[],
): T[] {
  if (baselineEvents.length === 0) {
    return currentEvents;
  }

  const existingToolCallIds = new Set<string>();
  let existingEventsWithoutIds = 0;

  for (const event of baselineEvents) {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;

    if (toolCallId) {
      existingToolCallIds.add(toolCallId);
    } else {
      existingEventsWithoutIds += 1;
    }
  }

  let skippedWithoutIds = 0;
  const deltaEvents: T[] = [];

  for (const event of currentEvents) {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;

    if (toolCallId) {
      if (existingToolCallIds.has(toolCallId)) {
        continue;
      }

      deltaEvents.push(event);
      continue;
    }

    if (skippedWithoutIds < existingEventsWithoutIds) {
      skippedWithoutIds += 1;
      continue;
    }

    deltaEvents.push(event);
  }

  return deltaEvents;
}

export async function persistUserMessage(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  "use step";

  if (message.role !== "user") {
    return;
  }

  try {
    const created = await createChatMessageIfNotExists({
      id: message.id,
      chatId,
      role: "user",
      parts: message,
    });

    if (!created) {
      return;
    }

    await touchChat(chatId);

    const shouldSetTitle = await isFirstChatMessage(chatId, created.id);
    if (!shouldSetTitle) {
      return;
    }

    const textContent = message.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (textContent.length === 0) {
      return;
    }

    const title =
      textContent.length > 80 ? `${textContent.slice(0, 80)}...` : textContent;
    await updateChat(chatId, { title });
  } catch (error) {
    console.error("[workflow] Failed to persist user message:", error);
  }
}

export async function persistAssistantMessage(
  chatId: string,
  message: WebAgentUIMessage,
): Promise<void> {
  "use step";

  try {
    const dedupedMessage = dedupeMessageReasoning(message);
    const result = await upsertChatMessageScoped({
      id: dedupedMessage.id,
      chatId,
      role: "assistant",
      parts: dedupedMessage,
    });

    if (result.status === "conflict") {
      console.warn(
        `[workflow] Skipped assistant upsert due to ID scope conflict: ${message.id}`,
      );
    } else if (result.status === "inserted") {
      await updateChatAssistantActivity(chatId, new Date());
    }
  } catch (error) {
    console.error("[workflow] Failed to persist assistant message:", error);
  }
}

export async function refreshLifecycleActivity(
  sessionId: string,
): Promise<void> {
  "use step";

  try {
    await updateSession(sessionId, buildLifecycleActivityUpdate(new Date()));
  } catch (error) {
    console.error("[workflow] Failed to refresh lifecycle activity:", error);
  }
}

export async function persistSandboxState(
  sessionId: string,
  sandboxState: SandboxState,
): Promise<void> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-harness/sandbox");
    const sandbox = await connectSandbox(sandboxState);
    const currentState = sandbox.getState?.() as SandboxState | undefined;
    if (currentState) {
      await updateSession(sessionId, {
        sandboxState: currentState,
        ...buildActiveLifecycleUpdate(currentState, {
          activityAt: new Date(),
        }),
      });
    }
  } catch (error) {
    console.error("[workflow] Failed to persist sandbox state:", error);
  }
}

const ACTIVE_STREAM_CLEAR_MAX_ATTEMPTS = 3;
const ACTIVE_STREAM_CLEAR_RETRY_DELAY_MS = 50;

export async function clearActiveStream(
  chatId: string,
  workflowRunId: string,
): Promise<void> {
  "use step";

  for (
    let attempt = 1;
    attempt <= ACTIVE_STREAM_CLEAR_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      // Only clear if this workflow's run ID is still the active one.
      // Prevents a late-finishing workflow from clearing a newer workflow's ID.
      await compareAndSetChatActiveStreamId(chatId, workflowRunId, null);
      return;
    } catch (error) {
      if (attempt === ACTIVE_STREAM_CLEAR_MAX_ATTEMPTS) {
        console.error("[workflow] Failed to clear activeStreamId:", error);
        return;
      }

      await delay(ACTIVE_STREAM_CLEAR_RETRY_DELAY_MS);
    }
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function recordWorkflowUsage(
  userId: string,
  modelId: string,
  totalUsage: LanguageModelUsage | undefined,
  responseMessage: WebAgentUIMessage,
  previousResponseMessage?: WebAgentUIMessage,
  workflowRun?: {
    workflowRunId: string;
    chatId: string;
    sessionId: string;
    status: WorkflowRunStatus;
    startedAt: string;
    finishedAt: string;
    totalDurationMs: number;
    stepTimings: WorkflowRunStepTiming[];
  },
): Promise<void> {
  "use step";

  try {
    const { collectTaskToolUsageEvents, sumLanguageModelUsage } =
      await import("@open-harness/agent");

    if (workflowRun) {
      try {
        await recordWorkflowRun({
          id: workflowRun.workflowRunId,
          chatId: workflowRun.chatId,
          sessionId: workflowRun.sessionId,
          userId,
          modelId,
          status: workflowRun.status,
          startedAt: workflowRun.startedAt,
          finishedAt: workflowRun.finishedAt,
          totalDurationMs: workflowRun.totalDurationMs,
          stepTimings: workflowRun.stepTimings,
        });
      } catch (error) {
        console.error("[workflow] Failed to record workflow run:", error);
      }
    }

    // Record main agent usage
    if (totalUsage) {
      await recordUsage(userId, {
        source: "web",
        agentType: "main",
        model: modelId,
        messages: [responseMessage],
        usage: {
          inputTokens: totalUsage.inputTokens ?? 0,
          cachedInputTokens: cachedInputTokensFor(totalUsage),
          outputTokens: totalUsage.outputTokens ?? 0,
        },
      });
    }

    // Record subagent usage (aggregated by model)
    const baselineSubagentUsageEvents = previousResponseMessage
      ? collectTaskToolUsageEvents(previousResponseMessage)
      : [];
    const subagentUsageEvents = filterNewTaskUsageEvents(
      collectTaskToolUsageEvents(responseMessage),
      baselineSubagentUsageEvents,
    );

    if (subagentUsageEvents.length > 0) {
      const subagentUsageByModel = new Map<string, UsageByModel>();

      for (const event of subagentUsageEvents) {
        const eventModelId = event.modelId ?? modelId;
        if (!eventModelId) {
          continue;
        }

        const existing = subagentUsageByModel.get(eventModelId);
        if (!existing) {
          subagentUsageByModel.set(eventModelId, {
            usage: event.usage,
            toolCallCount: 1,
          });
          continue;
        }

        const combinedUsage = sumLanguageModelUsage(
          existing.usage,
          event.usage,
        );
        if (!combinedUsage) {
          continue;
        }

        subagentUsageByModel.set(eventModelId, {
          usage: combinedUsage,
          toolCallCount: existing.toolCallCount + 1,
        });
      }

      for (const [eventModelId, modelUsage] of subagentUsageByModel) {
        await recordUsage(userId, {
          source: "web",
          agentType: "subagent",
          model: eventModelId,
          messages: [],
          usage: {
            inputTokens: modelUsage.usage.inputTokens ?? 0,
            cachedInputTokens: cachedInputTokensFor(modelUsage.usage),
            outputTokens: modelUsage.usage.outputTokens ?? 0,
          },
          toolCallCount: modelUsage.toolCallCount,
        });
      }
    }
  } catch (error) {
    console.error("[workflow] Failed to record usage:", error);
  }
}

export async function refreshDiffCache(
  sessionId: string,
  sandboxState: SandboxState,
): Promise<void> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-harness/sandbox");
    const { computeAndCacheDiff } = await import("@/lib/diff/compute-diff");
    const sandbox: Sandbox = await connectSandbox(sandboxState);
    await computeAndCacheDiff({ sandbox, sessionId });
  } catch (error) {
    console.error("[workflow] Failed to refresh diff cache:", error);
  }
}

export async function hasAutoCommitChangesStep(params: {
  sandboxState: SandboxState;
}): Promise<boolean> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-harness/sandbox");
    const sandbox: Sandbox = await connectSandbox(params.sandboxState);
    const statusResult = await sandbox.exec(
      "git status --porcelain",
      sandbox.workingDirectory,
      10000,
    );

    if (!statusResult.success) {
      return true;
    }

    return statusResult.stdout.trim().length > 0;
  } catch (error) {
    console.error("[workflow] Failed to preflight auto-commit changes:", error);
    return true;
  }
}

export async function runAutoCommitStep(params: {
  userId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
  sandboxState: SandboxState;
}): Promise<AutoCommitResult> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-harness/sandbox");
    const { performAutoCommit } = await import("@/lib/chat/auto-commit-direct");
    const sandbox = await connectSandbox(params.sandboxState);
    return await performAutoCommit({
      sandbox,
      userId: params.userId,
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
    });
  } catch (error) {
    console.error("[workflow] Auto-commit failed:", error);
    return {
      committed: false,
      pushed: false,
      error: error instanceof Error ? error.message : "Auto-commit failed",
    };
  }
}

export async function runAutoCreatePrStep(params: {
  userId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
  sandboxState: SandboxState;
}): Promise<AutoCreatePrResult> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-harness/sandbox");
    const { performAutoCreatePr } = await import("@/lib/chat/auto-pr-direct");
    const sandbox = await connectSandbox(params.sandboxState);
    const result = await performAutoCreatePr({
      sandbox,
      userId: params.userId,
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
    });

    if (result.error) {
      console.warn("[workflow] Auto-PR failed:", result.error);
    }

    return result;
  } catch (error) {
    console.error("[workflow] Auto-PR failed:", error);
    return {
      created: false,
      syncedExisting: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Auto-PR failed",
    };
  }
}
