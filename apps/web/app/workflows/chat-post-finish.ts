import type { LanguageModelUsage } from "ai";
import type { SandboxState, Sandbox } from "@open-harness/sandbox";
import type { WebAgentUIMessage } from "@/app/types";
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
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { recordUsage } from "@/lib/db/usage";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

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
      textContent.length > 30 ? `${textContent.slice(0, 30)}...` : textContent;
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
    const result = await upsertChatMessageScoped({
      id: message.id,
      chatId,
      role: "assistant",
      parts: message,
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

export async function clearActiveStream(
  chatId: string,
  workflowRunId: string,
): Promise<void> {
  "use step";
  try {
    // Only clear if this workflow's run ID is still the active one.
    // Prevents a late-finishing workflow from clearing a newer workflow's ID.
    await compareAndSetChatActiveStreamId(chatId, workflowRunId, null);
  } catch (error) {
    console.error("[workflow] Failed to clear activeStreamId:", error);
  }
}

export async function recordWorkflowUsage(
  userId: string,
  modelId: string,
  totalUsage: LanguageModelUsage | undefined,
  responseMessage: WebAgentUIMessage,
): Promise<void> {
  "use step";

  try {
    const { collectTaskToolUsageEvents, sumLanguageModelUsage } = await import(
      "@open-harness/agent"
    );

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
    const subagentUsageEvents = collectTaskToolUsageEvents(responseMessage);
    if (subagentUsageEvents.length > 0) {
      const subagentUsageByModel = new Map<string, LanguageModelUsage>();
      for (const event of subagentUsageEvents) {
        const eventModelId = event.modelId ?? modelId;
        if (!eventModelId) {
          continue;
        }

        const existing = subagentUsageByModel.get(eventModelId);
        const combined = sumLanguageModelUsage(existing, event.usage);
        if (combined) {
          subagentUsageByModel.set(eventModelId, combined);
        }
      }

      for (const [eventModelId, usage] of subagentUsageByModel) {
        await recordUsage(userId, {
          source: "web",
          agentType: "subagent",
          model: eventModelId,
          messages: [],
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            cachedInputTokens: cachedInputTokensFor(usage),
            outputTokens: usage.outputTokens ?? 0,
          },
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

export async function runAutoCommitStep(params: {
  userId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
  sandboxState: SandboxState;
}): Promise<void> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-harness/sandbox");
    const { performAutoCommit } = await import("@/lib/chat/auto-commit-direct");
    const sandbox = await connectSandbox(params.sandboxState);
    await performAutoCommit({
      sandbox,
      userId: params.userId,
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
    });
  } catch (error) {
    console.error("[workflow] Auto-commit failed:", error);
  }
}
