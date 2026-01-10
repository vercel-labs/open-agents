import { deepAgent } from "@open-harness/agent";
import { connectVercelSandbox } from "@open-harness/sandbox";
import { convertToModelMessages, type UIMessage } from "ai";

// Allow streaming responses up to 5 minutes (matching sandbox timeout)
export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages, sandboxId }: { messages: UIMessage[]; sandboxId: string } =
    await req.json();

  const modelMessages = await convertToModelMessages(messages);

  const sandbox = await connectVercelSandbox({ sandboxId });

  const result = await deepAgent.stream({
    messages: modelMessages,
    options: {
      workingDirectory: sandbox.workingDirectory,
      sandbox,
      autoApprove: "all",
    },
  });

  return result.toUIMessageStreamResponse();
}
