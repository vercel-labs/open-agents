import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { convertToModelMessages, gateway, type LanguageModelUsage } from "ai";
import { nanoid } from "nanoid";
import { WebAgentUIMessage } from "@/app/types";
import { webAgent } from "@/app/config";
import { getUserGitHubToken } from "@/lib/github/user-token";
import {
  createTaskMessageIfNotExists,
  getTaskById,
  updateTask,
  upsertTaskMessage,
} from "@/lib/db/tasks";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// Allow streaming responses up to 5 minutes (matching sandbox timeout)
export const maxDuration = 300;

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  taskId?: string;
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

  const { messages, taskId } = body;

  // 2. Require taskId to ensure sandbox ownership verification
  if (!taskId) {
    return Response.json({ error: "taskId is required" }, { status: 400 });
  }

  // 3. Verify task ownership
  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  // 4. Require active sandbox
  if (!isSandboxActive(task.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });

  // Get the GitHub token to pass as env var
  const githubToken = await getUserGitHubToken();

  // Connect sandbox (handles all modes, handoff, restoration)
  const sandbox = await connectSandbox(task.sandboxState, {
    env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
  });

  // Save user message immediately (incremental persistence)
  // Only save if the message has an ID (non-empty string) and hasn't been persisted yet
  if (taskId && messages.length > 0) {
    const userMessage = messages[messages.length - 1];
    if (
      userMessage &&
      userMessage.role === "user" &&
      typeof userMessage.id === "string" &&
      userMessage.id.length > 0
    ) {
      try {
        // Use idempotent insert to handle race conditions gracefully
        await createTaskMessageIfNotExists({
          id: userMessage.id,
          taskId,
          role: "user",
          parts: userMessage,
        });
      } catch (error) {
        console.error("Failed to save user message:", error);
      }
    }
  }

  // Resolve model from task's modelId, falling back to default if invalid
  const modelId = task.modelId ?? DEFAULT_MODEL_ID;
  let model;
  try {
    model = gateway(modelId);
  } catch (error) {
    console.error(
      `Invalid model ID "${modelId}", falling back to default:`,
      error,
    );
    model = gateway(DEFAULT_MODEL_ID);
  }

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
    },
    abortSignal: req.signal,
  });

  result.consumeStream();

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
    onFinish: async ({ responseMessage }) => {
      if (taskId) {
        // Save assistant message (upsert to handle tool results added client-side)
        try {
          await upsertTaskMessage({
            id: responseMessage.id,
            taskId,
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
              const currentTask = await getTaskById(taskId);
              if (
                currentTask?.sandboxState?.type === "hybrid" &&
                currentTask.sandboxState.sandboxId
              ) {
                // Background work has completed - use the sandboxId from DB
                // but also include pending operations from this session
                await updateTask(taskId, {
                  sandboxState: {
                    type: "hybrid",
                    sandboxId: currentTask.sandboxState.sandboxId,
                    pendingOperations:
                      "pendingOperations" in currentState
                        ? currentState.pendingOperations
                        : undefined,
                  },
                });
                return;
              }
            }

            await updateTask(taskId, {
              sandboxState: currentState,
            });
          } catch (error) {
            console.error("Failed to persist sandbox state:", error);
          }
        }
      }
    },
  });
}
