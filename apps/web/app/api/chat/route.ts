import { createHash } from "node:crypto";
import {
  collectTaskToolUsageEvents,
  createSandboxConfigFromInstance,
  discoverSkills,
  gateway,
  sumLanguageModelUsage,
} from "@open-harness/agent";
import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  readUIMessageStream,
  type GatewayModelId,
  type LanguageModelUsage,
  type UIMessageChunk,
} from "ai";
import { after } from "next/server";
import { start } from "workflow/api";
import type { ChatWorkflowResult } from "@/app/workflows/chat";
import { runDurableChatWorkflow } from "@/app/workflows/chat";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage } from "@/app/types";
import {
  compareAndSetChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatById,
  getSessionById,
  isFirstChatMessage,
  updateChat,
  updateChatActiveStreamId,
  updateChatAssistantActivity,
  updateSession,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import { recordUsage } from "@/lib/db/usage";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sessionId?: string;
  chatId?: string;
}

const SKILLS_CACHE_TTL_MS = 60_000;

type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

const discoveredSkillsCache = new Map<
  string,
  { skills: DiscoveredSkills; expiresAt: number }
>();
const remoteAuthFingerprintBySessionId = new Map<string, string>();

const getRemoteAuthFingerprint = (authUrl: string) =>
  createHash("sha256").update(authUrl).digest("hex");

const getSkillCacheKey = (sessionId: string, workingDirectory: string) =>
  `${sessionId}:${workingDirectory}`;

const pruneExpiredSkillCache = (now: number) => {
  for (const [key, entry] of discoveredSkillsCache) {
    if (entry.expiresAt <= now) {
      discoveredSkillsCache.delete(key);
    }
  }
};

export const maxDuration = 800;

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
  const now = Date.now();
  pruneExpiredSkillCache(now);
  const skillCacheKey = getSkillCacheKey(sessionId, sandbox.workingDirectory);
  const cachedSkills = discoveredSkillsCache.get(skillCacheKey);

  let skills: DiscoveredSkills;
  if (cachedSkills && cachedSkills.expiresAt > now) {
    skills = cachedSkills.skills;
  } else {
    skills = await discoverSkills(sandbox, skillDirs);
    discoveredSkillsCache.set(skillCacheKey, {
      skills,
      expiresAt: now + SKILLS_CACHE_TTL_MS,
    });
  }

  // Save the latest incoming message immediately (incremental persistence).
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
          const upsertResult = await upsertChatMessageScoped({
            id: latestMessage.id,
            chatId,
            role: "assistant",
            parts: latestMessage,
          });

          if (upsertResult.status === "inserted") {
            await updateChatAssistantActivity(chatId, new Date());
          }
        }
      } catch (error) {
        console.error("Failed to save latest chat message:", error);
      }
    }
  }

  // Resolve model from chat's modelId, falling back to default if invalid
  const modelId = chat.modelId ?? DEFAULT_MODEL_ID;
  let resolvedModelId = modelId;
  try {
    gateway(modelId as GatewayModelId);
  } catch (error) {
    console.error(
      `Invalid model ID "${modelId}", falling back to default:`,
      error,
    );
    resolvedModelId = DEFAULT_MODEL_ID;
  }

  // Resolve subagent model from user preferences (if configured)
  let subagentModelId: string | undefined;
  try {
    const preferences = await getUserPreferences(session.user.id);
    if (preferences.defaultSubagentModelId) {
      gateway(preferences.defaultSubagentModelId as GatewayModelId);
      subagentModelId = preferences.defaultSubagentModelId;
    }
  } catch (error) {
    console.error("Failed to resolve subagent model preference:", error);
  }

  const agentCallOptions = {
    sandboxConfig: createSandboxConfigFromInstance(sandbox),
    modelConfig: { modelId: resolvedModelId },
    ...(subagentModelId && {
      subagentModelConfig: { modelId: subagentModelId },
    }),
    approval: {
      type: "interactive" as const,
      autoApprove: "all" as const,
      sessionRules: [],
    },
    ...(skills.length > 0 && { skills }),
  };

  const run = await start(runDurableChatWorkflow, [
    modelMessages,
    {
      ...agentCallOptions,
      executionMode: "durable" as const,
    },
  ]);

  try {
    await updateChatActiveStreamId(chatId, run.runId);
  } catch (error) {
    void run.cancel().catch((cancelError) => {
      console.error("Failed to cancel chat workflow run after DB error:", cancelError);
    });
    throw error;
  }

  let streamRunIdCleared = false;
  const clearActiveRunId = async () => {
    if (streamRunIdCleared) {
      return false;
    }

    streamRunIdCleared = true;

    try {
      return await compareAndSetChatActiveStreamId(chatId, run.runId, null);
    } catch (error) {
      console.error("Failed to finalize active stream run id:", error);
      return false;
    }
  };

  after(async () => {
    let workflowResult: ChatWorkflowResult | null = null;
    try {
      workflowResult = await run.returnValue;
    } catch (error) {
      console.error("Durable chat workflow failed:", error);

      let partialResponseMessage: WebAgentUIMessage | null = null;
      try {
        for await (const message of readUIMessageStream<WebAgentUIMessage>({
          stream: run.getReadable<UIMessageChunk>(),
        })) {
          partialResponseMessage = message;
        }
      } catch (streamError) {
        console.error("Failed to recover partial workflow stream:", streamError);
      }

      if (partialResponseMessage) {
        workflowResult = {
          responseMessage: partialResponseMessage,
          totalMessageUsage: undefined,
        };
      }
    }

    if (!workflowResult) {
      await clearActiveRunId();
      return;
    }

    const stillOwnsStream = await clearActiveRunId();
    if (!stillOwnsStream) {
      return;
    }

    const activityAt = new Date();
    const responseMessage =
      workflowResult.responseMessage as WebAgentUIMessage | null;
    const totalMessageUsage = workflowResult.totalMessageUsage;

    if (responseMessage) {
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
          console.error("Failed to persist lifecycle activity:", activityError);
        }
      }
    }

    if (!responseMessage) {
      return;
    }

    const postUsage = (
      usage: LanguageModelUsage,
      usageModel: string,
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
      postUsage(totalMessageUsage, resolvedModelId, "main", [responseMessage]);
    }

    const subagentUsageEvents = collectTaskToolUsageEvents(responseMessage);
    if (subagentUsageEvents.length === 0) {
      return;
    }

    const defaultModelId = resolvedModelId;
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
  });

  return createUIMessageStreamResponse({
    stream: run.getReadable<UIMessageChunk>(),
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}
