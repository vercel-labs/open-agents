import { gateway } from "@open-harness/agent";
import {
  convertToModelMessages,
  type GatewayModelId,
  type LanguageModelUsage,
} from "ai";
import { nanoid } from "nanoid";
import { webAgent } from "@/app/config";
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
import { getUserPreferences } from "@/lib/db/user-preferences";
import { resolveModelSelection } from "@/lib/model-variants";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
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

  // Refresh lifecycle activity timestamps immediately so that any running
  // lifecycle workflow sees that the sandbox is in active use. Without this,
  // a long-running AI response could cause the sandbox to appear idle and
  // get hibernated mid-request.
  const requestStartedAt = new Date();
  const requestStartedAtMs = requestStartedAt.getTime();
  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });

  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });

  const { sandbox, skills } = await createChatRuntime({
    userId,
    sessionId,
    sessionRecord,
  });

  const ownedStreamToken = createStreamToken(requestStartedAtMs);
  const clearOwnedStreamToken = createOwnedStreamTokenClearer(
    chatId,
    ownedStreamToken,
  );

  let pendingAssistantSnapshot: WebAgentUIMessage | null = null;

  // Save the latest incoming user message immediately (incremental persistence).
  // Assistant snapshots are persisted after stream ownership is atomically claimed.
  if (messages.length > 0) {
    const latestMessage = messages[messages.length - 1];
    if (
      latestMessage &&
      (latestMessage.role === "user" || latestMessage.role === "assistant") &&
      typeof latestMessage.id === "string" &&
      latestMessage.id.length > 0
    ) {
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

          // Update chat title to first 30 chars of user's first message
          const shouldSetTitle =
            createdUserMessage !== undefined &&
            (await isFirstChatMessage(chatId, createdUserMessage.id));

          if (shouldSetTitle) {
            // This is the first message - extract text content for the title
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
        } else {
          pendingAssistantSnapshot = latestMessage;
        }
      } catch (error) {
        console.error("Failed to save latest chat message:", error);
      }
    }
  }

  const preferences = await getUserPreferences(userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });
  const modelVariants = preferences?.modelVariants ?? [];

  // Resolve model from chat's modelId, supporting variant IDs.
  const selectedModelId = chat.modelId ?? DEFAULT_MODEL_ID;
  const mainSelection = resolveModelSelection(selectedModelId, modelVariants);
  if (mainSelection.isMissingVariant) {
    console.warn(
      `Selected model variant "${selectedModelId}" was not found. Falling back to default model.`,
    );
  }

  const mainResolvedModelId = mainSelection.isMissingVariant
    ? DEFAULT_MODEL_ID
    : mainSelection.resolvedModelId;

  let model: GatewayModelId;
  let modelProviderOptions: typeof mainSelection.providerOptionsByProvider;
  try {
    model = mainResolvedModelId as GatewayModelId;
    modelProviderOptions = mainSelection.isMissingVariant
      ? undefined
      : mainSelection.providerOptionsByProvider;
    gateway(model, {
      providerOptionsOverrides: modelProviderOptions,
    });
  } catch (error) {
    console.error(
      `Invalid model ID "${mainResolvedModelId}", falling back to default:`,
      error,
    );
    model = DEFAULT_MODEL_ID as GatewayModelId;
    modelProviderOptions = undefined;
  }

  // Resolve subagent model from user preferences (if configured)
  let subagentModel: GatewayModelId | undefined;
  let subagentModelProviderOptions:
    | ReturnType<typeof resolveModelSelection>["providerOptionsByProvider"]
    | undefined;
  if (preferences?.defaultSubagentModelId) {
    const subagentSelection = resolveModelSelection(
      preferences.defaultSubagentModelId,
      modelVariants,
    );

    if (subagentSelection.isMissingVariant) {
      console.warn(
        `Subagent model variant "${preferences.defaultSubagentModelId}" was not found. Falling back to default model.`,
      );
    }

    const subagentResolvedModelId = subagentSelection.isMissingVariant
      ? DEFAULT_MODEL_ID
      : subagentSelection.resolvedModelId;

    try {
      subagentModel = subagentResolvedModelId as GatewayModelId;
      subagentModelProviderOptions = subagentSelection.isMissingVariant
        ? undefined
        : subagentSelection.providerOptionsByProvider;
      gateway(subagentModel, {
        providerOptionsOverrides: subagentModelProviderOptions,
      });
    } catch (error) {
      console.error("Failed to resolve subagent model preference:", error);
    }
  }

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
        model: {
          id: model,
          providerOptionsOverrides: modelProviderOptions,
        },
        ...(subagentModel
          ? {
              subagentModel: {
                id: subagentModel,
                providerOptionsOverrides: subagentModelProviderOptions,
              },
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
        model,
        totalMessageUsage,
        shouldAutoCommitOnFinish: abortLifecycle.shouldAutoCommitOnFinish(),
        preferences,
        clearOwnedStreamToken,
        responseMessage,
      });
    },
  });
}
