import type { SandboxState } from "@open-harness/sandbox";
import {
  collectTaskToolUsageEvents,
  sumLanguageModelUsage,
} from "@open-harness/agent";
import type { LanguageModel, LanguageModelUsage } from "ai";
import { after } from "next/server";
import type { WebAgentUIMessage } from "@/app/types";
import { runAutoCommitInBackground } from "@/lib/chat-auto-commit";
import {
  updateChatAssistantActivity,
  updateSession,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import { recordUsage } from "@/lib/db/usage";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import type { SessionRecord } from "./chat-context";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

function refreshCachedDiffInBackground(req: Request, sessionId: string): void {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) {
    return;
  }

  const diffUrl = new URL(`/api/sessions/${sessionId}/diff`, req.url);
  after(
    fetch(diffUrl, {
      method: "GET",
      headers: {
        cookie: cookieHeader,
      },
      cache: "no-store",
    })
      .then((response) => {
        if (response.ok) {
          return;
        }

        console.warn(
          `[chat] Failed to refresh cached diff for session ${sessionId}: ${response.status}`,
        );
      })
      .catch((error) => {
        console.error(
          `[chat] Failed to refresh cached diff for session ${sessionId}:`,
          error,
        );
      }),
  );
}

function scheduleAutoCommitInBackground(
  req: Request,
  params: {
    sessionId: string;
    sessionTitle: string;
    repoOwner: string;
    repoName: string;
  },
): void {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) {
    return;
  }

  after(
    runAutoCommitInBackground({
      requestUrl: req.url,
      cookieHeader,
      ...params,
    }).catch((error) => {
      console.error(
        `[chat] Auto commit background task failed for session ${params.sessionId}:`,
        error,
      );
    }),
  );
}

interface HandleChatStreamFinishParams {
  req: Request;
  userId: string;
  sessionId: string;
  chatId: string;
  sessionRecord: SessionRecord;
  sandbox: { getState?: () => unknown };
  model: LanguageModel | string;
  totalMessageUsage: LanguageModelUsage | undefined;
  shouldAutoCommitOnFinish: boolean;
  preferences: {
    autoCommitPush?: boolean;
  } | null;
  clearOwnedStreamToken: () => Promise<boolean>;
  responseMessage: WebAgentUIMessage;
}

export async function handleChatStreamFinish(
  params: HandleChatStreamFinishParams,
): Promise<void> {
  const {
    req,
    userId,
    sessionId,
    chatId,
    sessionRecord,
    sandbox,
    model,
    totalMessageUsage,
    shouldAutoCommitOnFinish,
    preferences,
    clearOwnedStreamToken,
    responseMessage,
  } = params;

  const stillOwnsStream = await clearOwnedStreamToken();

  if (!stillOwnsStream) {
    return;
  }

  const activityAt = new Date();

  // Save assistant message (upsert to handle tool results added client-side)
  try {
    const upsertResult = await upsertChatMessageScoped({
      id: responseMessage.id,
      chatId,
      role: "assistant",
      parts: responseMessage,
    });
    if (upsertResult.status === "conflict") {
      console.warn(
        `Skipped assistant onFinish upsert due to ID scope conflict: ${responseMessage.id}`,
      );
    } else if (upsertResult.status === "inserted") {
      await updateChatAssistantActivity(chatId, activityAt);
    }
  } catch (error) {
    console.error("Failed to save assistant message:", error);
  }

  // Persist sandbox state
  if (sandbox.getState) {
    try {
      const sandboxState = sandbox.getState() as SandboxState;

      await updateSession(sessionId, {
        sandboxState,
        ...buildActiveLifecycleUpdate(sandboxState, {
          activityAt,
        }),
      });
    } catch (error) {
      console.error("Failed to persist sandbox state:", error);
      // Even if sandbox state persistence fails, keep activity timestamps current.
      try {
        await updateSession(sessionId, {
          ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
            activityAt,
          }),
        });
      } catch (activityError) {
        console.error("Failed to persist lifecycle activity:", activityError);
      }
    }
  }

  const postUsage = (
    usage: LanguageModelUsage,
    usageModel: LanguageModel | string,
    agentType: "main" | "subagent",
    messages: WebAgentUIMessage[] = [],
  ) => {
    void recordUsage(userId, {
      source: "web",
      agentType,
      model: usageModel,
      messages,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        cachedInputTokens: cachedInputTokensFor(usage),
        outputTokens: usage.outputTokens ?? 0,
      },
    }).catch((e) => console.error("Failed to record usage:", e));
  };

  if (totalMessageUsage) {
    postUsage(totalMessageUsage, model, "main", [responseMessage]);
  }

  // Keep offline diff cache warm even when the chat page is not open.
  refreshCachedDiffInBackground(req, sessionId);

  const shouldAutoCommitPush =
    sessionRecord.autoCommitPushOverride ??
    preferences?.autoCommitPush ??
    false;

  if (
    shouldAutoCommitOnFinish &&
    shouldAutoCommitPush &&
    sessionRecord.cloneUrl &&
    sessionRecord.repoOwner &&
    sessionRecord.repoName
  ) {
    scheduleAutoCommitInBackground(req, {
      sessionId,
      sessionTitle: sessionRecord.title,
      repoOwner: sessionRecord.repoOwner,
      repoName: sessionRecord.repoName,
    });
  }

  const subagentUsageEvents = collectTaskToolUsageEvents(responseMessage);
  if (subagentUsageEvents.length === 0) {
    return;
  }

  const defaultModelId = typeof model === "string" ? model : model.modelId;
  const subagentUsageByModel = new Map<string, LanguageModelUsage>();
  for (const event of subagentUsageEvents) {
    const eventModelId = event.modelId ?? defaultModelId;
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
    postUsage(usage, eventModelId, "subagent");
  }
}
