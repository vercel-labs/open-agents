import { deepAgent } from "@open-harness/agent";
import { createJustBashSandbox } from "@open-harness/sandbox";
import { convertToModelMessages, type UIMessage } from "ai";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const modelMessages = await convertToModelMessages(messages);

  const workingDirectory = "/";

  const sandbox = await createJustBashSandbox({
    workingDirectory,
    mode: "memory",
  });

  const result = await deepAgent.stream({
    messages: modelMessages,
    options: {
      workingDirectory,
      sandbox,
    },
  });

  return result.toUIMessageStreamResponse();
}
