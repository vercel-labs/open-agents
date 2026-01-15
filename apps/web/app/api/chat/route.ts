import {
  connectVercelSandbox,
  JustBashSandbox,
  type JustBashSnapshot,
  type Sandbox,
} from "@open-harness/sandbox";
import { convertToModelMessages, gateway } from "ai";
import { nanoid } from "nanoid";
import { WebAgentUIMessage } from "@/app/types";
import { webAgent } from "@/app/config";
import { getUserGitHubToken } from "@/lib/github/user-token";
import {
  createTaskMessage,
  createTaskMessageIfNotExists,
  getTaskById,
  updateTask,
} from "@/lib/db/tasks";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import {
  HybridSandbox,
  type PendingOperation,
} from "@/lib/sandbox/hybrid-sandbox";

import { getServerSession } from "@/lib/session/get-server-session";

// Allow streaming responses up to 5 minutes (matching sandbox timeout)
export const maxDuration = 300;

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sandboxId?: string; // Optional for JustBash mode
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

  const { messages, sandboxId, taskId } = body;

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

  // Determine sandbox mode based on task state
  // Priority: explicit sandboxMode > presence of justBashSnapshot > Vercel sandboxId
  const isJustBashMode =
    task.sandboxMode === "justbash" ||
    (task.sandboxMode !== "vercel" && !!task.justBashSnapshot);
  const isVercelMode = task.sandboxMode === "vercel" || !isJustBashMode;

  // Check if frontend is sending a hybrid/JustBash placeholder ID
  // In hybrid mode, the frontend receives "justbash-<taskId>" as the sandboxId
  // After handoff, task.sandboxId changes to the real Vercel ID, but frontend may still have placeholder
  const isHybridPlaceholder = sandboxId?.startsWith("justbash-");

  // For Vercel mode, validate sandbox association (skip if hybrid placeholder)
  if (isVercelMode && !isHybridPlaceholder) {
    if (!task.sandboxId) {
      return Response.json(
        { error: "Sandbox not linked to task" },
        { status: 400 },
      );
    }
    if (task.sandboxId !== sandboxId) {
      return Response.json(
        { error: "Sandbox does not belong to this task" },
        { status: 403 },
      );
    }
  }

  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });

  // Get the GitHub token to pass as env var when reconnecting
  const githubToken = await getUserGitHubToken();

  // Create sandbox based on mode with hybrid handoff support
  let sandbox: Sandbox;
  let hybridSandbox: HybridSandbox | null = null;
  let handoffPerformed = false;

  if (isJustBashMode && task.justBashSnapshot) {
    // Check if Vercel is ready and perform inline handoff
    const vercelReady =
      task.vercelStatus === "ready" && task.sandboxId !== null;

    if (vercelReady) {
      // Perform inline handoff before agent runs
      const vercelSandbox = await connectVercelSandbox({
        sandboxId: task.sandboxId!,
        env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
      });

      // Replay pending operations
      const pendingOps = (task.pendingOperations as PendingOperation[]) ?? [];
      const errors: string[] = [];
      for (const op of pendingOps) {
        try {
          if (op.type === "mkdir") {
            await vercelSandbox.mkdir(op.path, { recursive: op.recursive });
          } else if (op.type === "writeFile") {
            await vercelSandbox.writeFile(op.path, op.content, "utf-8");
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push(`Failed to replay ${op.type} for ${op.path}: ${message}`);
        }
      }

      if (errors.length > 0) {
        console.warn("Handoff replay errors (non-fatal):", errors);
      }

      // Update task to Vercel mode
      await updateTask(taskId, {
        sandboxMode: "vercel",
        justBashSnapshot: null,
        pendingOperations: null,
      });

      sandbox = vercelSandbox;
      handoffPerformed = true;
      console.log(
        `[Chat] Inline handoff completed for task ${taskId}, replayed ${pendingOps.length} operations`,
      );
    } else {
      // Vercel not ready - use HybridSandbox wrapper
      const snapshot = task.justBashSnapshot as JustBashSnapshot;
      const justBashSandbox = await JustBashSandbox.fromSnapshot(snapshot);

      // Restore pending operations from previous requests
      const existingPendingOps =
        (task.pendingOperations as PendingOperation[]) ?? [];

      hybridSandbox = new HybridSandbox({
        justBash: justBashSandbox,
        pendingOperations: existingPendingOps,
        onVercelRequired: (command) => {
          console.log(
            `[Chat] Agent tried Vercel-required command: ${command}, Vercel status: ${task.vercelStatus}`,
          );
        },
      });
      sandbox = hybridSandbox;
    }
  } else {
    // Connect to Vercel sandbox directly
    // Use task.sandboxId (real Vercel ID) not the request's sandboxId (may be placeholder)
    const vercelSandboxId = task.sandboxId ?? sandboxId;
    if (!vercelSandboxId) {
      return Response.json(
        { error: "No sandbox ID available" },
        { status: 400 },
      );
    }
    sandbox = await connectVercelSandbox({
      sandboxId: vercelSandboxId,
      env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
    });
  }

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
      mode: "interactive",
      model,
      // TODO: consider enabling approvals for non-cloud-sandbox environments
      approvals: { autoApprove: "all" },
    },
    abortSignal: req.signal,
  });

  // Save assistant message on finish, and persist sandbox state if applicable
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: nanoid,
    onFinish: async ({ responseMessage }) => {
      if (taskId) {
        // Save assistant message
        try {
          await createTaskMessage({
            id: responseMessage.id,
            taskId,
            role: "assistant",
            parts: responseMessage,
          });
        } catch (error) {
          console.error("Failed to save assistant message:", error);
        }

        // Persist HybridSandbox state (JustBash snapshot + pending operations)
        if (hybridSandbox && !handoffPerformed) {
          try {
            // Get the underlying JustBash sandbox for serialization
            const justBash =
              hybridSandbox.getJustBashSandbox() as JustBashSandbox;
            const updatedSnapshot = justBash.serialize();
            const pendingOps = hybridSandbox.pendingOperations;

            await updateTask(taskId, {
              justBashSnapshot: updatedSnapshot,
              pendingOperations: pendingOps,
            });

            console.log(
              `[Chat] Persisted HybridSandbox state for task ${taskId}: ${pendingOps.length} pending operations`,
            );
          } catch (error) {
            console.error("Failed to persist HybridSandbox state:", error);
          }
        }
      }
    },
  });
}
