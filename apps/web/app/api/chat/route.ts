import {
  collectTaskToolUsageEvents,
  discoverSkills,
  gateway,
  sumLanguageModelUsage,
} from "@open-harness/agent";
import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import {
  convertToModelMessages,
  type GatewayModelId,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { nanoid } from "nanoid";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage } from "@/app/types";
import {
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatById,
  getChatMessages,
  getSessionById,
  updateChat,
  updateChatAssistantActivity,
  updateSession,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import { recordUsage } from "@/lib/db/usage";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import { onStopSignal } from "@/lib/stop-signal";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sessionId?: string;
  chatId?: string;
}

const STREAM_TOKEN_SEPARATOR = ":";

const createStreamToken = (startedAtMs: number) =>
  `${startedAtMs}${STREAM_TOKEN_SEPARATOR}${nanoid()}`;

const parseStreamTokenStartedAt = (streamToken: string | null) => {
  if (!streamToken) {
    return null;
  }

  const separatorIndex = streamToken.indexOf(STREAM_TOKEN_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const startedAt = Number(streamToken.slice(0, separatorIndex));
  if (!Number.isFinite(startedAt)) {
    return null;
  }

  return startedAt;
};

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, sessionId, chatId } = body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  if (!sessionId || !chatId) {
    return Response.json(
      { error: "sessionId and chatId are required" },
      { status: 400 },
    );
  }

  // 3. Verify session + chat ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }
  const chat = await getChatById(chatId);
  if (!chat || chat.sessionId !== sessionId) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  // 4. Require active sandbox
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
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

  // Resolve a repo-scoped GitHub token when possible.
  let githubToken: string | null = null;
  if (sessionRecord.repoOwner) {
    try {
      const tokenResult = await getRepoToken(
        session.user.id,
        sessionRecord.repoOwner,
      );
      githubToken = tokenResult.token;
    } catch {
      githubToken = await getUserGitHubToken();
    }
  } else {
    githubToken = await getUserGitHubToken();
  }

  // Connect sandbox (handles all modes, handoff, restoration)
  const sandbox = await connectSandbox(sessionRecord.sandboxState, {
    env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
  });

  if (githubToken && sessionRecord.repoOwner && sessionRecord.repoName) {
    const authUrl = `https://x-access-token:${githubToken}@github.com/${sessionRecord.repoOwner}/${sessionRecord.repoName}.git`;
    const remoteResult = await sandbox.exec(
      `git remote set-url origin "${authUrl}"`,
      sandbox.workingDirectory,
      5000,
    );

    if (!remoteResult.success) {
      console.warn(
        `Failed to refresh git remote auth for session ${sessionId}: ${remoteResult.stderr ?? remoteResult.stdout}`,
      );
    }
  }

  // Discover skills from the sandbox's working directory
  // Only project-level skills (no user home directory in remote sandboxes)
  // TODO: Optimize if this becomes a bottleneck (~20ms no skills, ~130ms with 5 skills)
  const skillBaseFolders = [".claude", ".agents"];
  const skillDirs = skillBaseFolders.map(
    (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
  );
  const skills = await discoverSkills(sandbox, skillDirs);

  let ownedStreamToken = createStreamToken(requestStartedAtMs);

  const claimStreamOwnership = async () => {
    // Retry once if another request updates activeStreamId between our read and CAS.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latestChat = await getChatById(chatId);
      const activeStreamId = latestChat?.activeStreamId ?? null;
      const activeStartedAt = parseStreamTokenStartedAt(activeStreamId);

      if (
        activeStartedAt !== null &&
        activeStartedAt > requestStartedAtMs &&
        activeStreamId !== ownedStreamToken
      ) {
        return false;
      }

      const claimed = await compareAndSetChatActiveStreamId(
        chatId,
        activeStreamId,
        ownedStreamToken,
      );
      if (claimed) {
        return true;
      }
    }

    return false;
  };

  let pendingAssistantSnapshot: WebAgentUIMessage | null = null;

  // Save the latest incoming user message immediately (incremental persistence).
  // Assistant snapshots are persisted after stream ownership is atomically claimed.
  if (chatId && messages.length > 0) {
    const latestMessage = messages[messages.length - 1];
    if (
      latestMessage &&
      (latestMessage.role === "user" || latestMessage.role === "assistant") &&
      typeof latestMessage.id === "string" &&
      latestMessage.id.length > 0
    ) {
      try {
        if (latestMessage.role === "user") {
          await createChatMessageIfNotExists({
            id: latestMessage.id,
            chatId,
            role: "user",
            parts: latestMessage,
          });

          // Update chat title to first 30 chars of user's first message
          const existingMessages = await getChatMessages(chatId);
          if (existingMessages.length === 1) {
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

  // Resolve model from chat's modelId, falling back to default if invalid
  const modelId = chat.modelId ?? DEFAULT_MODEL_ID;
  let model;
  try {
    model = gateway(modelId as GatewayModelId);
  } catch (error) {
    console.error(
      `Invalid model ID "${modelId}", falling back to default:`,
      error,
    );
    model = gateway(DEFAULT_MODEL_ID as GatewayModelId);
  }

  // Use Redis stop signals as the sole cancellation mechanism for generation.
  // We intentionally do not bind `req.signal` so a transient client disconnect
  // does not cancel work; clients can reconnect via resumable streams.
  const controller = new AbortController();
  const unsubscribeStop = await onStopSignal(chatId, () => {
    controller.abort();
  });

  let stopSignalClosed = false;
  const closeStopSignal = () => {
    if (stopSignalClosed) {
      return;
    }
    stopSignalClosed = true;
    unsubscribeStop();
  };

  let streamTokenCleared = false;
  const clearOwnedStreamToken = async () => {
    if (streamTokenCleared) {
      return false;
    }
    streamTokenCleared = true;
    try {
      return await compareAndSetChatActiveStreamId(
        chatId,
        ownedStreamToken,
        null,
      );
    } catch (error) {
      console.error("Failed to finalize active stream token:", error);
      return false;
    }
  };

  let result;
  try {
    result = await webAgent.stream({
      messages: modelMessages,
      options: {
        sandbox,
        model,
        // TODO: consider enabling approvals for non-cloud-sandbox environments
        approval: {
          type: "interactive",
          autoApprove: "all",
          sessionRules: [],
        },
        ...(skills.length > 0 && { skills }),
      },
      abortSignal: controller.signal,
    });
  } catch (error) {
    closeStopSignal();
    await clearOwnedStreamToken();
    throw error;
  }

  void result.consumeStream().then(
    () => closeStopSignal(),
    async () => {
      closeStopSignal();
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

      const claimed = await claimStreamOwnership();
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
      if (chatId) {
        closeStopSignal();
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
        // For hybrid sandboxes, we need to be careful not to overwrite the sandboxId
        // that may have been set by background work (the onCloudSandboxReady hook)
        if (sandbox.getState) {
          try {
            const currentState = sandbox.getState() as SandboxState;
            let sandboxStateToPersist = currentState;

            // For hybrid sandboxes in pre-handoff state (has files, no sandboxId),
            // check if background work has already set a sandboxId we should preserve
            if (
              currentState.type === "hybrid" &&
              "files" in currentState &&
              !currentState.sandboxId
            ) {
              const currentSession = await getSessionById(sessionId);
              if (
                currentSession?.sandboxState?.type === "hybrid" &&
                currentSession.sandboxState.sandboxId
              ) {
                // Background work has completed - use the sandboxId from DB
                // but also include pending operations from this session
                sandboxStateToPersist = {
                  type: "hybrid",
                  sandboxId: currentSession.sandboxState.sandboxId,
                  pendingOperations:
                    "pendingOperations" in currentState
                      ? currentState.pendingOperations
                      : undefined,
                };
              }
            }

            await updateSession(sessionId, {
              sandboxState: sandboxStateToPersist,
              ...buildActiveLifecycleUpdate(sandboxStateToPersist, {
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
              console.error(
                "Failed to persist lifecycle activity:",
                activityError,
              );
            }
          }
        }

        const postUsage = (
          usage: LanguageModelUsage,
          usageModel: LanguageModel | string,
          agentType: "main" | "subagent",
          messages: WebAgentUIMessage[] = [],
        ) => {
          void recordUsage(session.user.id, {
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

        const subagentUsageEvents = collectTaskToolUsageEvents(responseMessage);
        if (subagentUsageEvents.length === 0) {
          return;
        }

        const defaultModelId =
          typeof model === "string" ? model : model.modelId;
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
    },
  });
}
