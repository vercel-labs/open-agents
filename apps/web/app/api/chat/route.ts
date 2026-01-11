import { deepAgent } from "@open-harness/agent";
import { connectVercelSandbox } from "@open-harness/sandbox";
import { convertToModelMessages } from "ai";
import { WebAgentUIMessage } from "@/app/types";
import { getUserGitHubToken } from "@/lib/github/user-token";

// Allow streaming responses up to 5 minutes (matching sandbox timeout)
export const maxDuration = 300;

export async function POST(req: Request) {
  const {
    messages,
    sandboxId,
  }: { messages: WebAgentUIMessage[]; sandboxId: string } = await req.json();

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

  return result.toUIMessageStreamResponse();
}
