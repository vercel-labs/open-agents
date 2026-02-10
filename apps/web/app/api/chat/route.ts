import { discoverSkills, gateway } from "@open-harness/agent";
import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import {
  convertToModelMessages,
  type GatewayModelId,
  type LanguageModelUsage,
} from "ai";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage } from "@/app/types";
import {
  createChatMessageIfNotExists,
  getChatById,
  getChatMessages,
  getSessionById,
  updateChat,
  updateChatActiveStreamId,
  updateSession,
  upsertChatMessage,
} from "@/lib/db/sessions";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import { onStopSignal } from "@/lib/stop-signal";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// Allow streaming responses up to 5 minutes per response turn.
export const maxDuration = 300;

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sessionId?: string;
  chatId?: string;
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
  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });
  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });

  // Get the GitHub token to pass as env var
  const githubToken = await getUserGitHubToken();

  // Connect sandbox (handles all modes, handoff, restoration)
  const sandbox = await connectSandbox(sessionRecord.sandboxState, {
    env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
  });

  // Discover skills from the sandbox's working directory
  // Only project-level skills (no user home directory in remote sandboxes)
  // TODO: Optimize if this becomes a bottleneck (~20ms no skills, ~130ms with 5 skills)
  const skillBaseFolders = [".claude", ".agents"];
  const skillDirs = skillBaseFolders.map(
    (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
  );
  const skills = await discoverSkills(sandbox, skillDirs);

  // Save user message immediately (incremental persistence)
  // Only save if the message has an ID (non-empty string) and hasn't been persisted yet
  if (chatId && messages.length > 0) {
    const userMessage = messages[messages.length - 1];
    if (
      userMessage &&
      userMessage.role === "user" &&
      typeof userMessage.id === "string" &&
      userMessage.id.length > 0
    ) {
      try {
        // Use idempotent insert to handle race conditions gracefully
        await createChatMessageIfNotExists({
          id: userMessage.id,
          chatId,
          role: "user",
          parts: userMessage,
        });

        // Update chat title to first 30 chars of user's first message
        const existingMessages = await getChatMessages(chatId);
        if (existingMessages.length === 1) {
          // This is the first message - extract text content for the title
          const textContent = userMessage.parts
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
      } catch (error) {
        console.error("Failed to save user message:", error);
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

  // Create abort controller with shared Redis pub/sub for instant stop
  const controller = new AbortController();
  const unsubscribeStop = await onStopSignal(chatId, () => {
    controller.abort();
  });

  const finalizeStream = async () => {
    unsubscribeStop();
    await updateChatActiveStreamId(chatId, null);
  };

  const result = await webAgent.stream({
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

  void result.consumeStream().then(
    () => finalizeStream(),
    () => finalizeStream(),
  );

  // Track last step usage for message metadata
  let lastStepUsage: LanguageModelUsage | undefined;

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
        return { lastStepUsage, totalMessageUsage: part.totalUsage };
      }
      return undefined;
    },
    async consumeSseStream({ stream }) {
      const streamId = nanoid();
      await resumableStreamContext.createNewResumableStream(
        streamId,
        () => stream,
      );
      await updateChatActiveStreamId(chatId, streamId);
    },
    onFinish: async ({ responseMessage }) => {
      await finalizeStream();

      if (chatId) {
        const activityAt = new Date();

        // Save assistant message (upsert to handle tool results added client-side)
        try {
          await upsertChatMessage({
            id: responseMessage.id,
            chatId,
            role: "assistant",
            parts: responseMessage,
          });
        } catch (error) {
          console.error("Failed to save assistant message:", error);
        }

        // Persist sandbox state
        // For hybrid sandboxes, we need to be careful not to overwrite the sandboxId
        // that may have been set by background work (the onCloudSandboxReady hook)
        if (sandbox.getState) {
          try {
            const currentState = sandbox.getState() as SandboxState;

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
                const mergedHybridState: SandboxState = {
                  type: "hybrid",
                  sandboxId: currentSession.sandboxState.sandboxId,
                  pendingOperations:
                    "pendingOperations" in currentState
                      ? currentState.pendingOperations
                      : undefined,
                };
                await updateSession(sessionId, {
                  sandboxState: mergedHybridState,
                  ...buildActiveLifecycleUpdate(mergedHybridState, {
                    activityAt,
                  }),
                });

                kickSandboxLifecycleWorkflow({
                  sessionId,
                  reason: "chat-finished",
                  scheduleBackgroundWork: (cb) => after(cb),
                });
                return;
              }
            }

            await updateSession(sessionId, {
              sandboxState: currentState,
              ...buildActiveLifecycleUpdate(currentState, { activityAt }),
            });

            kickSandboxLifecycleWorkflow({
              sessionId,
              reason: "chat-finished",
              scheduleBackgroundWork: (cb) => after(cb),
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
      }
    },
  });
}
