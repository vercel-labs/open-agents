import { convertToModelMessages, type LanguageModelUsage } from "ai";
import { nanoid } from "nanoid";
import { webAgent } from "@/app/config";
import {
  updateChatAssistantActivity,
  updateSession,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
import { scheduleLatestMessagePersistence } from "./_lib/message-persistence";
import { resolveChatModelSelection } from "./_lib/model-selection";
import { handleChatStreamFinish } from "./_lib/post-finish";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";
import { createChatRuntime } from "./_lib/runtime";
import {
  claimStreamOwnership,
  createOwnedStreamTokenClearer,
  createStreamToken,
  setupStreamAbortLifecycle,
} from "./_lib/stream-lifecycle";

export const maxDuration = 800;

export async function POST(req: Request) {
  // 1. Validate session
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }
  const userId = authResult.userId;

  const parsedBody = await parseChatRequestBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const { messages } = parsedBody.body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  const chatIdentifiers = requireChatIdentifiers(parsedBody.body);
  if (!chatIdentifiers.ok) {
    return chatIdentifiers.response;
  }
  const { sessionId, chatId } = chatIdentifiers;

  // 3. Verify session + chat ownership
  const chatContext = await requireOwnedSessionChat({
    userId,
    sessionId,
    chatId,
    forbiddenMessage: "Unauthorized",
    requireActiveSandbox: true,
    sandboxInactiveMessage: "Sandbox not initialized",
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { sessionRecord, chat } = chatContext;
  const activeSandboxState = sessionRecord.sandboxState;
  if (!activeSandboxState) {
    throw new Error("Sandbox not initialized");
  }

  const requestStartedAt = new Date();
  const requestStartedAtMs = requestStartedAt.getTime();

  const ownedStreamToken = createStreamToken(requestStartedAtMs);
  const clearOwnedStreamToken = createOwnedStreamTokenClearer(
    chatId,
    ownedStreamToken,
  );

  // Save the latest incoming user message in the background.
  // Assistant snapshots are persisted after stream ownership is atomically claimed.
  const pendingAssistantSnapshot = scheduleLatestMessagePersistence(
    chatId,
    messages,
  );

  // Refresh lifecycle activity so long-running responses don't look idle.
  // Keep this synchronous so lifecycle workers see activity before generation starts.
  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });

  const modelMessagesPromise = convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });
  const runtimePromise = createChatRuntime({
    userId,
    sessionId,
    sessionRecord,
  });
  const preferencesPromise = getUserPreferences(userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });

  const [modelMessages, { sandbox, skills }, preferences] = await Promise.all([
    modelMessagesPromise,
    runtimePromise,
    preferencesPromise,
  ]);

  const modelVariants = preferences?.modelVariants ?? [];
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId: chat.modelId,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: preferences.defaultSubagentModelId,
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;

  // Use Redis stop signals as the sole cancellation mechanism for generation.
  // We intentionally do not bind `req.signal` so a transient client disconnect
  // does not cancel work; clients can reconnect via resumable streams.
  const abortLifecycle = await setupStreamAbortLifecycle(chatId);

  let result;
  try {
    result = await webAgent.stream({
      messages: modelMessages,
      options: {
        sandbox: {
          state: activeSandboxState,
          workingDirectory: sandbox.workingDirectory,
          currentBranch: sandbox.currentBranch,
          environmentDetails: sandbox.environmentDetails,
        },
        model: mainModelSelection,
        ...(subagentModelSelection
          ? {
              subagentModel: subagentModelSelection,
            }
          : {}),
        ...(skills.length > 0 && { skills }),
      },
      abortSignal: abortLifecycle.controller.signal,
    });
  } catch (error) {
    abortLifecycle.cleanup();
    await clearOwnedStreamToken();
    throw error;
  }

  void result.consumeStream().then(
    () => {
      abortLifecycle.cleanup();
    },
    async () => {
      abortLifecycle.cleanup();
      await clearOwnedStreamToken();
    },
  );

  // Track last step usage for message metadata
  let lastStepUsage: LanguageModelUsage | undefined;
  let totalMessageUsage: LanguageModelUsage | undefined;

  // Save assistant message on finish, and persist sandbox state if applicable
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: nanoid,
    messageMetadata: ({ part }) => {
      // Track per-step usage from finish-step events. The last step's input
      // tokens represents actual context window utilization.
      if (part.type === "finish-step") {
        lastStepUsage = part.usage;
        return { lastStepUsage, totalMessageUsage: undefined };
      }
      // On finish, include both the last step usage and total message usage
      if (part.type === "finish") {
        totalMessageUsage = part.totalUsage;
        return { lastStepUsage, totalMessageUsage: part.totalUsage };
      }
      return undefined;
    },
    async consumeSseStream({ stream }) {
      await resumableStreamContext.createNewResumableStream(
        ownedStreamToken,
        () => stream,
      );

      const claimed = await claimStreamOwnership({
        chatId,
        ownedStreamToken,
        requestStartedAtMs,
      });
      if (!claimed) {
        return;
      }

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
    },
    onFinish: async ({ responseMessage }) => {
      abortLifecycle.cleanup();
      await handleChatStreamFinish({
        req,
        userId,
        sessionId,
        chatId,
        sessionRecord,
        sandbox,
        model: mainModelSelection.id,
        totalMessageUsage,
        shouldAutoCommitOnFinish: abortLifecycle.shouldAutoCommitOnFinish(),
        preferences,
        clearOwnedStreamToken,
        responseMessage,
      });
    },
  });
}
