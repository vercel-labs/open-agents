import {
  convertToModelMessages,
  type FinishReason,
  generateId as generateIdAi,
  isToolUIPart,
  type ModelMessage,
  type UIMessageChunk,
} from "ai";
import { getWorkflowMetadata, getWritable } from "workflow";
import { getRun } from "workflow/api";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage, WebAgentMessageMetadata } from "@/app/types";
import type { OpenHarnessAgentCallOptions } from "@open-harness/agent";

type Options = {
  messages: WebAgentUIMessage[];
  agentOptions: OpenHarnessAgentCallOptions;
  maxSteps?: number;
};

type Writable = WritableStream<UIMessageChunk>;

const shouldPauseForToolInteraction = (parts: WebAgentUIMessage["parts"]) =>
  parts.some(
    (part) =>
      isToolUIPart(part) &&
      (part.state === "input-available" || part.state === "approval-requested"),
  );

const convertMessages = async (
  messages: WebAgentUIMessage[],
): Promise<ModelMessage[]> => {
  "use step";
  return await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    tools: webAgent.tools,
  });
};

const generateId = async () => {
  "use step";
  return generateIdAi();
};

export async function runAgentWorkflow(options: Options) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const writable = getWritable<UIMessageChunk>();

  const latestMessage = options.messages.at(-1);

  if (latestMessage == null) {
    throw new Error("runAgentWorkflow requires at least one message");
  }

  const [modelMessages, assistantId] = await Promise.all([
    convertMessages(options.messages),
    latestMessage.role === "assistant"
      ? Promise.resolve(latestMessage.id)
      : generateId(),
  ]);

  let pendingAssistantResponse: WebAgentUIMessage =
    latestMessage.role === "assistant"
      ? {
          ...latestMessage,
          metadata: latestMessage.metadata ?? ({} as WebAgentMessageMetadata),
          parts: [...latestMessage.parts],
        }
      : {
          role: "assistant",
          id: assistantId,
          parts: [],
          metadata: {} as WebAgentMessageMetadata,
        };

  let originalMessagesForStep: WebAgentUIMessage[] = [latestMessage];

  await sendStart(writable, assistantId);

  let finishReason: FinishReason = "stop";
  let wasAborted = false;

  for (
    let step = 0;
    options.maxSteps === undefined || step < options.maxSteps;
    step++
  ) {
    const result = await runAgentStep(
      modelMessages,
      originalMessagesForStep,
      assistantId,
      writable,
      workflowRunId,
      options.agentOptions,
    );

    pendingAssistantResponse =
      result.responseMessage ?? pendingAssistantResponse;
    originalMessagesForStep = [pendingAssistantResponse];
    modelMessages.push(...result.responseMessages);
    finishReason = result.finishReason;
    wasAborted = wasAborted || result.stepWasAborted;

    if (
      result.finishReason !== "tool-calls" ||
      shouldPauseForToolInteraction(
        result.responseMessage?.parts ?? pendingAssistantResponse.parts,
      )
    ) {
      break;
    }
  }

  await sendFinish(writable);
  await closeStream(writable);
}

const runAgentStep = async (
  messages: ModelMessage[],
  originalMessages: WebAgentUIMessage[],
  messageId: string,
  writable: Writable,
  workflowRunId: string,
  agentOptions: OpenHarnessAgentCallOptions,
) => {
  "use step";

  const abortController = new AbortController();
  const stopMonitor = startStopMonitor(workflowRunId, abortController);

  try {
    let responseMessage: WebAgentUIMessage | undefined;

    const result = await webAgent.stream({
      messages,
      options: agentOptions,
      abortSignal: abortController.signal,
    });

    for await (const part of result.toUIMessageStream<WebAgentUIMessage>({
      originalMessages,
      generateMessageId: () => messageId,
      sendStart: false,
      sendFinish: false,
      onFinish: ({ responseMessage: finishedResponseMessage }) => {
        responseMessage = finishedResponseMessage;
      },
    })) {
      const writer = writable.getWriter();
      await writer.write(part);
      writer.releaseLock();
    }

    if (responseMessage == null) {
      throw new Error("Agent stream finished without a response message");
    }

    return {
      responseMessage,
      responseMessages: (await result.response).messages,
      finishReason: await result.finishReason,
      stepWasAborted: false,
    };
  } catch (error) {
    if (isAbortError(error)) {
      const abortedFinishReason: FinishReason = "stop";
      return {
        responseMessage: undefined,
        responseMessages: [],
        finishReason: abortedFinishReason,
        stepWasAborted: true,
      };
    }

    throw error;
  } finally {
    stopMonitor.stop();
    await stopMonitor.done;
  }
};

function startStopMonitor(runId: string, abortController: AbortController) {
  let shouldStop = false;

  const done = (async () => {
    const run = getRun(runId);

    while (!shouldStop && !abortController.signal.aborted) {
      let runStatus:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled";

      try {
        runStatus = await run.status;
      } catch {
        await delay(150);
        continue;
      }

      if (runStatus === "cancelled") {
        abortController.abort();
        return;
      }

      await delay(150);
    }
  })();

  return {
    stop() {
      shouldStop = true;
    },
    done,
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function sendStart(writable: Writable, messageId: string) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "start", messageId });
  } finally {
    writer.releaseLock();
  }
}

async function sendFinish(writable: Writable) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "finish", finishReason: "stop" });
  } finally {
    writer.releaseLock();
  }
}

async function closeStream(writable: Writable) {
  "use step";
  await writable.close();
}
