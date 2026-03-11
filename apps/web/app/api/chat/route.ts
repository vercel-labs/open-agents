import { createHash } from "node:crypto";
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
import { after } from "next/server";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage } from "@/app/types";
import {
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatById,
  getSessionById,
  isFirstChatMessage,
  touchChat,
  updateChat,
  updateChatAssistantActivity,
  updateSession,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import { recordUsage } from "@/lib/db/usage";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { runAutoCommitInBackground } from "@/lib/chat-auto-commit";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { resolveModelSelection } from "@/lib/model-variants";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import { onStopSignal } from "@/lib/stop-signal";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

const DEFAULT_CONTEXT_LIMIT = 200_000;

interface ChatCompactionContextPayload {
  contextLimit?: number;
  lastInputTokens?: number;
}

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sessionId?: string;
  chatId?: string;
  context?: ChatCompactionContextPayload;
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function toPositiveInputTokens(value: unknown): number | undefined {
  const normalized = toPositiveInteger(value);
  return normalized && normalized > 0 ? normalized : undefined;
}

function extractLastInputTokensFromMessages(
  messages: WebAgentUIMessage[],
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }

    const metadata = (message as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      continue;
    }

    const lastStepUsage = (metadata as { lastStepUsage?: unknown })
      .lastStepUsage;
    if (!lastStepUsage || typeof lastStepUsage !== "object") {
      continue;
    }

    const inputTokens = (lastStepUsage as { inputTokens?: unknown })
      .inputTokens;
    const normalizedTokens = toPositiveInputTokens(inputTokens);
    if (normalizedTokens) {
      return normalizedTokens;
    }
  }

  return undefined;
}

const STREAM_TOKEN_SEPARATOR = ":";

type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

const remoteAuthFingerprintBySessionId = new Map<string, string>();

const createStreamToken = (startedAtMs: number) =>
  `${startedAtMs}${STREAM_TOKEN_SEPARATOR}${nanoid()}`;

const getRemoteAuthFingerprint = (authUrl: string) =>
  createHash("sha256").update(authUrl).digest("hex");

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

export const maxDuration = 800;

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

  const {
    messages,
    sessionId,
    chatId,
    context: requestedCompactionContext,
  } = body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  if (!sessionId || !chatId) {
    return Response.json(
      { error: "sessionId and chatId are required" },
      { status: 400 },
    );
  }

  // 3. Verify session + chat ownership
  const [sessionRecord, chat] = await Promise.all([
    getSessionById(sessionId),
    getChatById(chatId),
  ]);

  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }
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
    ports: DEFAULT_SANDBOX_PORTS,
  });

  if (githubToken && sessionRecord.repoOwner && sessionRecord.repoName) {
    const authUrl = `https://x-access-token:${githubToken}@github.com/${sessionRecord.repoOwner}/${sessionRecord.repoName}.git`;
    const authFingerprint = getRemoteAuthFingerprint(authUrl);
    const previousAuthFingerprint =
      remoteAuthFingerprintBySessionId.get(sessionId);

    if (previousAuthFingerprint !== authFingerprint) {
      const remoteResult = await sandbox.exec(
        `git remote set-url origin "${authUrl}"`,
        sandbox.workingDirectory,
        5000,
      );

      if (!remoteResult.success) {
        console.warn(
          `Failed to refresh git remote auth for session ${sessionId}: ${remoteResult.stderr ?? remoteResult.stdout}`,
        );
      } else {
        remoteAuthFingerprintBySessionId.set(sessionId, authFingerprint);
      }
    }
  } else {
    remoteAuthFingerprintBySessionId.delete(sessionId);
  }

  // Discover skills from the sandbox's working directory
  // Only project-level skills (no user home directory in remote sandboxes)
  // TODO: Optimize if this becomes a bottleneck (~20ms no skills, ~130ms with 5 skills)
  const skillBaseFolders = [".claude", ".agents"];
  const skillDirs = skillBaseFolders.map(
    (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
  );

  const cachedSkills = await getCachedSkills(
    sessionId,
    sessionRecord.sandboxState,
  );

  let skills: DiscoveredSkills;
  if (cachedSkills !== null) {
    skills = cachedSkills;
  } else {
    skills = await discoverSkills(sandbox, skillDirs);
    await setCachedSkills(sessionId, sessionRecord.sandboxState, skills);
  }

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

  const preferences = await getUserPreferences(session.user.id).catch(
    (error) => {
      console.error("Failed to load user preferences:", error);
      return null;
    },
  );
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

  let model;
  try {
    model = gateway(mainResolvedModelId as GatewayModelId, {
      providerOptionsOverrides: mainSelection.isMissingVariant
        ? undefined
        : mainSelection.providerOptionsByProvider,
    });
  } catch (error) {
    console.error(
      `Invalid model ID "${mainResolvedModelId}", falling back to default:`,
      error,
    );
    model = gateway(DEFAULT_MODEL_ID as GatewayModelId);
  }

  // Resolve subagent model from user preferences (if configured)
  let subagentModel: LanguageModel | undefined;
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
      subagentModel = gateway(subagentResolvedModelId as GatewayModelId, {
        providerOptionsOverrides: subagentSelection.isMissingVariant
          ? undefined
          : subagentSelection.providerOptionsByProvider,
      });
    } catch (error) {
      console.error("Failed to resolve subagent model preference:", error);
    }
  }

  const requestedContextLimit = toPositiveInteger(
    requestedCompactionContext?.contextLimit,
  );
  const requestedLastInputTokens = toPositiveInputTokens(
    requestedCompactionContext?.lastInputTokens,
  );
  const inferredLastInputTokens = extractLastInputTokensFromMessages(messages);

  const compactionContext = {
    contextLimit: requestedContextLimit ?? DEFAULT_CONTEXT_LIMIT,
    lastInputTokens: requestedLastInputTokens ?? inferredLastInputTokens,
  };

  // Use Redis stop signals as the sole cancellation mechanism for generation.
  // We intentionally do not bind `req.signal` so a transient client disconnect
  // does not cancel work; clients can reconnect via resumable streams.
  const controller = new AbortController();
  const unsubscribeStop = await onStopSignal(chatId, () => {
    controller.abort();
  });

  // Abort gracefully before the platform kills the function at maxDuration,
  // so that onFinish fires and we persist the partial response.
  const PRE_TIMEOUT_MS = 730_000;
  const timeoutHandle = setTimeout(() => {
    console.warn("[chat] Aborting before maxDuration timeout");
    controller.abort();
  }, PRE_TIMEOUT_MS);

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
        subagentModel,
        context: compactionContext,
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
    clearTimeout(timeoutHandle);
    closeStopSignal();
    await clearOwnedStreamToken();
    throw error;
  }

  void result.consumeStream().then(
    () => {
      clearTimeout(timeoutHandle);
      closeStopSignal();
    },
    async () => {
      clearTimeout(timeoutHandle);
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
      clearTimeout(timeoutHandle);
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

        // Keep offline diff cache warm even when the chat page is not open.
        refreshCachedDiffInBackground(req, sessionId);

        if (
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
