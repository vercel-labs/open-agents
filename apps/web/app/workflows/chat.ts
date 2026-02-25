import {
  readUIMessageStream,
  type FinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { getWritable } from "workflow";

export interface DurableAgentCallOptions {
  sandboxConfig: unknown;
  approval: unknown;
  modelConfig?: unknown;
  subagentModelConfig?: unknown;
  customInstructions?: string;
  executionMode?: "normal" | "durable";
  skills?: unknown[];
}

export interface ChatWorkflowResult {
  responseMessage: UIMessage | null;
  totalMessageUsage?: LanguageModelUsage;
}

export async function runDurableChatWorkflow(
  messages: ModelMessage[],
  options: DurableAgentCallOptions,
): Promise<ChatWorkflowResult> {
  "use workflow";

  const writable = getWritable<UIMessageChunk>();
  let modelMessages = messages;
  let responseMessage: UIMessage | null = null;
  let totalMessageUsage: LanguageModelUsage | undefined;

  const maxIterations = 10;

  for (let i = 0; i < maxIterations; i += 1) {
    const result = await runChatStep(modelMessages, writable, options);
    modelMessages = [...modelMessages, ...result.responseMessages];
    responseMessage = result.responseMessage;
    totalMessageUsage = result.totalMessageUsage;

    if (result.finishReason !== "tool-calls") {
      break;
    }
  }

  await closeStream(writable);

  return {
    responseMessage,
    totalMessageUsage,
  };
}

async function runChatStep(
  messages: ModelMessage[],
  writable: WritableStream<UIMessageChunk>,
  callOptions: DurableAgentCallOptions,
) {
  "use step";

  const { webAgent } = await import("@/app/config");

  let lastStepUsage: LanguageModelUsage | undefined;
  let totalMessageUsage: LanguageModelUsage | undefined;

  const result = await webAgent.stream({
    messages,
    options: {
      ...callOptions,
      executionMode: "durable",
    } as never,
  });

  const stream = result.toUIMessageStream<UIMessage>({
    messageMetadata: ({ part }) => {
      if (part.type === "finish-step") {
        lastStepUsage = part.usage;
        return { lastStepUsage, totalMessageUsage: undefined };
      }

      if (part.type === "finish") {
        totalMessageUsage = part.totalUsage;
        return { lastStepUsage, totalMessageUsage: part.totalUsage };
      }

      return undefined;
    },
  });

  const [streamForWritable, streamForMessage] = stream.tee();
  const reader = streamForWritable.getReader();
  const writer = writable.getWriter();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      await writer.write(value);
    }
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }

  let responseMessage: UIMessage | null = null;
  for await (const message of readUIMessageStream<UIMessage>({
    stream: streamForMessage,
  })) {
    responseMessage = message;
  }

  const response = await result.response;
  const finishReason = (await result.finishReason) as FinishReason;

  return {
    responseMessage,
    responseMessages: response.messages,
    finishReason,
    totalMessageUsage,
  };
}

async function closeStream(writable: WritableStream<UIMessageChunk>) {
  "use step";

  await writable.close();
}
