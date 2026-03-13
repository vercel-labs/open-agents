import { type SandboxState } from "@open-harness/sandbox";
import { type LanguageModel, type LanguageModelUsage } from "ai";
import { after } from "next/server";
import type { WebAgentUIMessage } from "@/app/types";
import {
  createChatMessageIfNotExists,
  isFirstChatMessage,
  touchChat,
  updateChat,
  updateChatAssistantActivity,
  updateSession,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import { recordUsage } from "@/lib/db/usage";
import { runAutoCommitInBackground } from "@/lib/chat-auto-commit";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";

interface AutoCommitScheduleParams {
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
}

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

export function refreshCachedDiffInBackground(
  req: Request,
  sessionId: string,
): void {
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

export function scheduleAutoCommitInBackground(
  req: Request,
  params: AutoCommitScheduleParams,
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

export async function persistLatestIncomingMessage(params: {
  chatId: string;
  messages: WebAgentUIMessage[];
}): Promise<WebAgentUIMessage | null> {
  const { chatId, messages } = params;

  if (messages.length === 0) {
    return null;
  }

  const latestMessage = messages[messages.length - 1];
  if (
    !latestMessage ||
    (latestMessage.role !== "user" && latestMessage.role !== "assistant") ||
    typeof latestMessage.id !== "string" ||
    latestMessage.id.length === 0
  ) {
    return null;
  }

  try {
    if (latestMessage.role === "user") {
      const createdUserMessage = await createChatMessageIfNotExists({
        id: latestMessage.id,
        chatId,
        role: "user",
        parts: latestMessage,
      });

      if (createdUserMessage) {
        await touchChat(chatId);
      }

      const shouldSetTitle =
        createdUserMessage !== undefined &&
        (await isFirstChatMessage(chatId, createdUserMessage.id));

      if (shouldSetTitle) {
        const textContent = latestMessage.parts
          .filter(
            (part): part is { type: "text"; text: string } =>
              part.type === "text",
          )
          .map((part) => part.text)
          .join(" ")
          .trim();

        if (textContent.length > 0) {
          const title =
            textContent.length > 30
              ? `${textContent.slice(0, 30)}...`
              : textContent;
          await updateChat(chatId, { title });
        }
      }

      return null;
    }

    return latestMessage;
  } catch (error) {
    console.error("Failed to save latest chat message:", error);
    return null;
  }
}

export async function persistAssistantSnapshotIfNeeded(params: {
  chatId: string;
  pendingAssistantSnapshot: WebAgentUIMessage | null;
}): Promise<void> {
  const { chatId, pendingAssistantSnapshot } = params;

  if (!pendingAssistantSnapshot) {
    return;
  }

  try {
    const upsertResult = await upsertChatMessageScoped({
      id: pendingAssistantSnapshot.id,
      chatId,
      role: "assistant",
      parts: pendingAssistantSnapshot,
    });

    if (upsertResult.status === "conflict") {
      console.warn(
        `Skipped assistant message upsert due to ID scope conflict: ${pendingAssistantSnapshot.id}`,
      );
    } else if (upsertResult.status === "inserted") {
      await updateChatAssistantActivity(chatId, new Date());
    }
  } catch (error) {
    console.error("Failed to save latest chat message:", error);
  }
}

export async function persistAssistantResponse(params: {
  chatId: string;
  responseMessage: WebAgentUIMessage;
  activityAt: Date;
}): Promise<void> {
  const { chatId, responseMessage, activityAt } = params;

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
}

export async function persistSandboxStateWithActivityFallback(params: {
  sessionId: string;
  sandbox: {
    getState?: () => unknown;
  };
  fallbackSandboxState: SandboxState | null | undefined;
  activityAt: Date;
}): Promise<void> {
  const { sessionId, sandbox, fallbackSandboxState, activityAt } = params;

  if (!sandbox.getState) {
    return;
  }

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

    try {
      await updateSession(sessionId, {
        ...buildActiveLifecycleUpdate(fallbackSandboxState, {
          activityAt,
        }),
      });
    } catch (activityError) {
      console.error("Failed to persist lifecycle activity:", activityError);
    }
  }
}

export function recordUsageInBackground(params: {
  userId: string;
  usage: LanguageModelUsage;
  usageModel: LanguageModel | string;
  agentType: "main" | "subagent";
  messages?: WebAgentUIMessage[];
}): void {
  const { userId, usage, usageModel, agentType, messages = [] } = params;

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
  }).catch((error) => {
    console.error("Failed to record usage:", error);
  });
}
