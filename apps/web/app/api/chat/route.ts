import {
  collectTaskToolUsageEvents,
  sumLanguageModelUsage,
} from "@open-harness/agent";
import { convertToModelMessages, type LanguageModelUsage } from "ai";
import { nanoid } from "nanoid";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage } from "@/app/types";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import {
  persistAssistantResponse,
  persistAssistantSnapshotIfNeeded,
  persistLatestIncomingMessage,
  persistSandboxStateWithActivityFallback,
  recordUsageInBackground,
  refreshCachedDiffInBackground,
  scheduleAutoCommitInBackground,
} from "./_lib/chat-persistence";
import { resolveChatModelContext } from "./_lib/model-context";
import { prepareChatRequestContext } from "./_lib/request-context";
import { setupChatSandbox } from "./_lib/sandbox-setup";
import {
  createStreamOwnershipManager,
  createStreamToken,
  setupGenerationAbortControl,
} from "./_lib/stream-control";

export const maxDuration = 800;

export async function POST(req: Request) {
  const prepared = await prepareChatRequestContext(req);
  if (!prepared.ok) {
    return prepared.response;
  }

  const {
    userId,
    messages,
    sessionId,
    chatId,
    requestedCompactionContext,
    sessionRecord,
    chat,
    requestStartedAtMs,
  } = prepared.context;

  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });

  const { sandbox, skills } = await setupChatSandbox({
    sessionId,
    userId,
    sessionRecord,
  });

  const pendingAssistantSnapshot = await persistLatestIncomingMessage({
    chatId,
    messages,
  });

  const { preferences, model, subagentModel, compactionContext } =
    await resolveChatModelContext({
      userId,
      chatModelId: chat.modelId,
      messages,
      requestedCompactionContext,
    });

  const streamToken = createStreamToken(requestStartedAtMs);

  const { claimStreamOwnership, clearOwnedStreamToken } =
    createStreamOwnershipManager({
      chatId,
      requestStartedAtMs,
      streamToken,
    });

  const abortControl = await setupGenerationAbortControl(chatId);

  let result;
  try {
    result = await webAgent.stream({
      messages: modelMessages,
      options: {
        sandbox,
        model,
        subagentModel,
        context: compactionContext,
        approval: {
          type: "interactive",
          autoApprove: "all",
          sessionRules: [],
        },
        ...(skills.length > 0 && { skills }),
      },
      abortSignal: abortControl.controller.signal,
    });
  } catch (error) {
    abortControl.close();
    await clearOwnedStreamToken();
    throw error;
  }

  void result.consumeStream().then(
    () => {
      abortControl.close();
    },
    async () => {
      abortControl.close();
      await clearOwnedStreamToken();
    },
  );

  let lastStepUsage: LanguageModelUsage | undefined;
  let totalMessageUsage: LanguageModelUsage | undefined;

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: nanoid,
    messageMetadata: ({ part }) => {
      if (part.type === "finish-step") {
        lastStepUsage = part.usage;
        return { lastStepUsage, totalMessageUsage: undefined };
      }

      if (part.type === "finish") {
        totalMessageUsage = part.totalUsage;
        return { lastStepUsage, totalMessageUsage: part.totalUsage };
      }

      return undefined;
    },
    async consumeSseStream({ stream }) {
      await resumableStreamContext.createNewResumableStream(
        streamToken,
        () => stream,
      );

      const claimed = await claimStreamOwnership();
      if (!claimed) {
        return;
      }

      await persistAssistantSnapshotIfNeeded({
        chatId,
        pendingAssistantSnapshot,
      });
    },
    onFinish: async ({ responseMessage }) => {
      abortControl.close();

      const stillOwnsStream = await clearOwnedStreamToken();
      if (!stillOwnsStream) {
        return;
      }

      const activityAt = new Date();
      const uiResponseMessage = responseMessage as WebAgentUIMessage;

      await persistAssistantResponse({
        chatId,
        responseMessage: uiResponseMessage,
        activityAt,
      });

      await persistSandboxStateWithActivityFallback({
        sessionId,
        sandbox,
        fallbackSandboxState: sessionRecord.sandboxState,
        activityAt,
      });

      if (totalMessageUsage) {
        recordUsageInBackground({
          userId,
          usage: totalMessageUsage,
          usageModel: model,
          agentType: "main",
          messages: [uiResponseMessage],
        });
      }

      refreshCachedDiffInBackground(req, sessionId);

      if (
        abortControl.shouldAutoCommitOnFinish() &&
        preferences?.autoCommitPush &&
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
        recordUsageInBackground({
          userId,
          usage,
          usageModel: eventModelId,
          agentType: "subagent",
        });
      }
    },
  });
}
