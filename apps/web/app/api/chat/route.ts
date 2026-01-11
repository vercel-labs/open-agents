import { deepAgent } from "@open-harness/agent";
import { connectVercelSandbox } from "@open-harness/sandbox";
import { convertToModelMessages } from "ai";
import { nanoid } from "nanoid";
import { WebAgentUIMessage } from "@/app/types";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { updateTask, createTaskMessage } from "@/lib/db/tasks";

// Allow streaming responses up to 5 minutes (matching sandbox timeout)
export const maxDuration = 300;

interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sandboxId: string;
  taskId?: string;
}

export async function POST(req: Request) {
  const { messages, sandboxId, taskId }: ChatRequestBody = await req.json();

  // If this is a task-based chat, update the task with the sandbox ID
  if (taskId && sandboxId) {
    try {
      await updateTask(taskId, { sandboxId });
    } catch (error) {
      console.error("Failed to update task with sandbox ID:", error);
    }
  }

  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: deepAgent.tools,
  });

  // Get the GitHub token to pass as env var when reconnecting
  const githubToken = await getUserGitHubToken();

  const sandbox = await connectVercelSandbox({
    sandboxId,
    env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
  });

  // Save user message immediately (incremental persistence)
  if (taskId && messages.length > 0) {
    const userMessage = messages[messages.length - 1];
    if (userMessage && userMessage.role === "user") {
      await createTaskMessage({
        id: userMessage.id ?? nanoid(),
        taskId,
        role: "user",
        parts: userMessage,
      });
    }
  }

  const result = await deepAgent.stream({
    messages: modelMessages,
    options: {
      workingDirectory: sandbox.workingDirectory,
      sandbox,
      // TODO: consider enabling approvals for non-cloud-sandbox environments
      autoApprove: "all",
    },
    abortSignal: req.signal,
  });

  // Save assistant message on finish
  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      if (taskId) {
        await createTaskMessage({
          id: responseMessage.id ?? nanoid(),
          taskId,
          role: "assistant",
          parts: responseMessage,
        });
      }
    },
  });
}
