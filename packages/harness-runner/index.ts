import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { AiSdkHarnessSandboxProvider } from "@open-agents/sandbox/vercel";
import {
  jsonSchema,
  readUIMessageStream,
  tool,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import {
  createHarnessAdapter,
  HARNESS_INACTIVE_TOOLS,
  type ExternalHarnessId,
} from "./adapters.ts";
import { ensureGatewayApiKeyEnv } from "./auth.ts";
import { HARNESS_INSTRUCTIONS } from "./instructions.ts";
import {
  collectPendingToolResultContinuations,
  parseHarnessResumeState,
} from "./session-resume.ts";
import {
  addHarnessUsage,
  harnessUsageFromMetadataValue,
  type HarnessUsage,
} from "./usage.ts";
import { linkHarnessWorkingDirectory } from "./workspace.ts";

export {
  createHarnessAdapter,
  EXTERNAL_HARNESS_IDS,
  type ExternalHarnessId,
  isExternalHarnessId,
  resolveClaudeCodeModelId,
  resolveCodexModelId,
  resolvePiModelId,
} from "./adapters.ts";
export { HARNESS_INSTRUCTIONS } from "./instructions.ts";
export { ensureGatewayApiKeyEnv, resolveGatewayApiKey } from "./auth.ts";
export { prepareHarnessSandboxRuntimeProfile } from "./prewarm.ts";

export type HarnessUIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type HarnessUIMessageChunk = {
  type: string;
  [key: string]: unknown;
};

export {
  addHarnessUsage,
  harnessUsageFromMetadataValue,
  type HarnessUsage,
} from "./usage.ts";

export type HarnessTurnResult = {
  responseMessage: HarnessUIMessage;
  finishReason:
    | "stop"
    | "length"
    | "content-filter"
    | "tool-calls"
    | "error"
    | "other";
  rawFinishReason?: string;
  usage?: HarnessUsage;
  /**
   * JSON-serializable session state to persist and pass back as
   * `resumeState` on the next turn. Undefined when the session could not be
   * parked for resume (the next turn then starts a fresh session).
   */
  resumeState?: unknown;
};

export type RunHarnessTurnInput = {
  harnessId: ExternalHarnessId;
  sandboxProvider: AiSdkHarnessSandboxProvider;
  workingDirectory: string;
  sessionId: string;
  messageId: string;
  messages: HarnessUIMessage[];
  originalMessages: HarnessUIMessage[];
  selectedModelId: string;
  modelId: string;
  /** Session state returned by a previous turn's `resumeState`, if any. */
  resumeState?: unknown;
  abortSignal?: AbortSignal;
  onChunk: (chunk: HarnessUIMessageChunk) => Promise<void> | void;
};

export const OPEN_AGENT_HARNESS_TOOLS = {
  ask_user_question: tool({
    description: `Ask the user structured questions during execution to gather preferences, clarify requirements, or get decisions.

Use this when the user asks you to ask questions, when requirements are ambiguous, or when the next step depends on a human choice.

Always use this lower-case ask_user_question tool. Never use Claude Code's built-in AskUserQuestion tool.

Users can select provided options or enter custom text.`,
    inputSchema: jsonSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              question: {
                type: "string",
                description: "The complete question to ask the user.",
              },
              header: {
                type: "string",
                maxLength: 12,
                description: "Short label for tab/chip display.",
              },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    label: {
                      type: "string",
                      description: "1-5 words, concise choice text.",
                    },
                    description: {
                      type: "string",
                      description: "Explanation of trade-offs or implications.",
                    },
                  },
                  required: ["label", "description"],
                },
              },
              multiSelect: {
                type: "boolean",
                description: "Whether the user can select multiple options.",
              },
            },
            required: ["question", "header", "options"],
          },
        },
      },
      required: ["questions"],
    }),
  }),
  todo_write: tool({
    description: `Create and manage a structured task list for the current session.

Use this for multi-step work, checklists, or when the user gives several requirements. This tool replaces the entire todo list, so always send the full updated list.

Only one todo should be in_progress at a time. Mark work in_progress before starting it and completed as soon as it is done.`,
    inputSchema: jsonSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        todos: {
          type: "array",
          description:
            "The complete list of todo items. This replaces existing todos.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description: "Stable unique identifier for the todo item.",
              },
              content: {
                type: "string",
                description: "Clear, concise task description.",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description:
                  "Current status. Only one task should be in_progress at a time.",
              },
            },
            required: ["id", "content", "status"],
          },
        },
      },
      required: ["todos"],
    }),
    execute: async ({ todos }) => ({
      success: true,
      message: `Updated task list with ${todos.length} items`,
      todos,
    }),
  }),
} satisfies ToolSet;

const OPEN_AGENT_TOOL_NAMES = new Set([
  "todo_write",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
  "task",
  "ask_user_question",
  "skill",
  "web_fetch",
]);

function isOpenAgentToolName(toolName: unknown): toolName is string {
  return typeof toolName === "string" && OPEN_AGENT_TOOL_NAMES.has(toolName);
}

function stripDynamicFlag(chunk: HarnessUIMessageChunk): HarnessUIMessageChunk {
  const { dynamic: _dynamic, ...mappedChunk } = chunk;
  return mappedChunk;
}

export function mapOpenAgentToolChunk(
  chunk: HarnessUIMessageChunk,
): HarnessUIMessageChunk {
  if (
    (chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error") &&
    chunk.dynamic === true &&
    isOpenAgentToolName(chunk.toolName)
  ) {
    return stripDynamicFlag(chunk);
  }

  return chunk;
}

function createOpenAgentToolMappingStream(): TransformStream<
  HarnessUIMessageChunk,
  HarnessUIMessageChunk
> {
  const pausedQuestionToolCallIds = new Set<string>();

  return new TransformStream({
    transform(chunk, controller) {
      if (
        (chunk.type === "tool-input-start" ||
          chunk.type === "tool-input-available" ||
          chunk.type === "tool-input-error") &&
        chunk.toolName === "ask_user_question" &&
        typeof chunk.toolCallId === "string"
      ) {
        pausedQuestionToolCallIds.add(chunk.toolCallId);
      }

      if (
        chunk.type === "tool-approval-request" &&
        typeof chunk.toolCallId === "string" &&
        pausedQuestionToolCallIds.has(chunk.toolCallId)
      ) {
        return;
      }

      controller.enqueue(mapOpenAgentToolChunk(chunk));
    },
  });
}

export function createHarnessStepBoundaryStream(): TransformStream<
  HarnessUIMessageChunk,
  HarnessUIMessageChunk
> {
  let isFirstChunk = true;

  return new TransformStream({
    transform(chunk, controller) {
      if (isFirstChunk) {
        isFirstChunk = false;
        if (chunk.type !== "start-step") {
          controller.enqueue({ type: "start-step" });
        }
      }

      controller.enqueue(chunk);
    },
  });
}

function stringifyCompact(value: unknown): string {
  const serialized = JSON.stringify(value) ?? String(value);
  return serialized.length > 2_000
    ? `${serialized.slice(0, 2_000)}...`
    : serialized;
}

function formatAskUserQuestionOutput(output: unknown): string | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }

  if ("declined" in output && output.declined === true) {
    return "User declined to answer the questions.";
  }

  if (!("answers" in output)) {
    return null;
  }

  const answers = output.answers;
  if (typeof answers !== "object" || answers === null) {
    return null;
  }

  const formattedAnswers = Object.entries(
    answers as Record<string, unknown>,
  ).map(([question, answer]) => {
    const formattedAnswer = Array.isArray(answer)
      ? answer.join(", ")
      : String(answer);
    return `"${question}"="${formattedAnswer}"`;
  });

  if (formattedAnswers.length === 0) {
    return "User answered the questions.";
  }

  return `User answered questions: ${formattedAnswers.join(", ")}.`;
}

function toolNameFromPart(part: Record<string, unknown>): string | null {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }

  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }

  return null;
}

function textFromToolPart(part: Record<string, unknown>): string | null {
  const toolName = toolNameFromPart(part);
  if (!toolName) {
    return null;
  }

  if (part.state === "approval-responded") {
    const approval =
      typeof part.approval === "object" && part.approval !== null
        ? (part.approval as Record<string, unknown>)
        : undefined;
    const approved = approval?.approved;
    if (approved === true) {
      return `User approved the ${toolName} tool call.`;
    }
    if (approved === false) {
      const reason =
        typeof approval?.reason === "string"
          ? ` Reason: ${approval.reason}`
          : "";
      return `User denied the ${toolName} tool call.${reason}`;
    }
  }

  if (part.state === "output-denied") {
    return `User denied the ${toolName} tool call.`;
  }

  if (part.state !== "output-available") {
    return null;
  }

  if (toolName === "ask_user_question") {
    return formatAskUserQuestionOutput(part.output);
  }

  if (!("output" in part)) {
    return null;
  }

  return `${toolName} tool output: ${stringifyCompact(part.output)}`;
}

function textFromPart(part: Record<string, unknown>): string | null {
  if (part.type === "text" && typeof part.text === "string") {
    return part.text;
  }

  if (part.type === "data-snippet" && typeof part.data === "object") {
    return JSON.stringify(part.data);
  }

  const toolText = textFromToolPart(part);
  if (toolText) {
    return toolText;
  }

  return null;
}

export function buildHarnessPrompt(messages: HarnessUIMessage[]): string {
  return messages
    .map((message) => {
      const text = message.parts
        .map(textFromPart)
        .filter((part): part is string => part !== null)
        .join("\n")
        .trim();

      if (!text) {
        return null;
      }

      return `${message.role === "assistant" ? "Assistant" : "User"}:\n${text}`;
    })
    .filter((message): message is string => message !== null)
    .join("\n\n");
}

function withHarnessMetadata(
  message: HarnessUIMessage,
  input: Pick<RunHarnessTurnInput, "selectedModelId" | "modelId">,
  result: Pick<HarnessTurnResult, "finishReason" | "rawFinishReason" | "usage">,
): HarnessUIMessage {
  // Continuation turns reuse the assistant message id, so carry the previous
  // turns' accumulated usage and step history forward instead of resetting.
  const existingTotalMessageUsage = harnessUsageFromMetadataValue(
    message.metadata?.totalMessageUsage,
  );
  const existingStepFinishReasons = Array.isArray(
    message.metadata?.stepFinishReasons,
  )
    ? message.metadata.stepFinishReasons
    : [];
  const totalMessageUsage =
    result.usage && existingTotalMessageUsage
      ? addHarnessUsage(existingTotalMessageUsage, result.usage)
      : (result.usage ?? existingTotalMessageUsage);

  return {
    ...message,
    metadata: {
      ...message.metadata,
      selectedModelId: input.selectedModelId,
      modelId: input.modelId,
      ...(result.usage ? { lastStepUsage: result.usage } : {}),
      ...(totalMessageUsage ? { totalMessageUsage } : {}),
      lastStepFinishReason: result.finishReason,
      ...(result.rawFinishReason
        ? { lastStepRawFinishReason: result.rawFinishReason }
        : {}),
      stepFinishReasons: [
        ...existingStepFinishReasons,
        {
          finishReason: result.finishReason,
          ...(result.rawFinishReason
            ? { rawFinishReason: result.rawFinishReason }
            : {}),
        },
      ],
    },
  };
}

export function extractHarnessCostUsd(metadata: unknown): number | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return;
  }

  const claudeCode = (metadata as Record<string, unknown>)["claude-code"];
  if (typeof claudeCode !== "object" || claudeCode === null) {
    return;
  }

  const costUsd = (claudeCode as Record<string, unknown>).costUsd;
  return typeof costUsd === "number" && Number.isFinite(costUsd)
    ? costUsd
    : undefined;
}

function toHarnessUsage(
  usage: LanguageModelUsage,
  providerMetadata: unknown,
): HarnessUsage {
  const costUsd = extractHarnessCostUsd(providerMetadata);

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    inputTokenDetails: {
      noCacheTokens: usage.inputTokenDetails.noCacheTokens,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    },
    outputTokenDetails: {
      textTokens: usage.outputTokenDetails.textTokens,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    },
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

export async function assembleHarnessResponseMessage(
  stream: ReadableStream<HarnessUIMessageChunk>,
  messageId: string,
  seedMessage?: HarnessUIMessage,
): Promise<HarnessUIMessage> {
  // Seed with the persisted assistant message on continuation turns so the
  // assembled message keeps earlier parts and metadata instead of replacing
  // the stored row with only this turn's output.
  let responseMessage: HarnessUIMessage =
    seedMessage &&
    seedMessage.role === "assistant" &&
    seedMessage.id === messageId
      ? { ...seedMessage, parts: [...seedMessage.parts] }
      : {
          id: messageId,
          role: "assistant",
          parts: [],
        };
  const mappedStream = stream.pipeThrough(createOpenAgentToolMappingStream());

  for await (const message of readUIMessageStream({
    message: responseMessage as never,
    stream: mappedStream as never,
    terminateOnError: true,
  })) {
    responseMessage = message as HarnessUIMessage;
  }

  return responseMessage;
}

type OpenAgentHarness = HarnessAgent<
  ReturnType<typeof createHarnessAdapter>,
  typeof OPEN_AGENT_HARNESS_TOOLS
>;
type OpenAgentHarnessSession = Awaited<
  ReturnType<OpenAgentHarness["createSession"]>
>;
type OpenAgentHarnessStream = Awaited<ReturnType<OpenAgentHarness["stream"]>>;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Start this turn against the harness. Resumes the previous turn's session
 * when resume state is provided and usable — delivering pending client tool
 * results (answered questions) or prompting only the newest message — and
 * falls back to a fresh session primed with the full transcript otherwise.
 */
async function startHarnessTurn(
  agent: OpenAgentHarness,
  input: RunHarnessTurnInput,
): Promise<{
  session: OpenAgentHarnessSession;
  stream: OpenAgentHarnessStream;
}> {
  const abort = input.abortSignal ? { abortSignal: input.abortSignal } : {};
  const resumeState = parseHarnessResumeState(
    input.resumeState,
    input.harnessId,
  );

  if (resumeState) {
    let session: OpenAgentHarnessSession | undefined;
    try {
      session = await agent.createSession({
        sessionId: input.sessionId,
        resumeFrom: resumeState,
        ...abort,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      // Unusable resume state (recreated sandbox, harness update, forked
      // chat). Fall through to a fresh session.
    }

    if (session) {
      try {
        if (session.hasUnfinishedTurn()) {
          const toolResultContinuations = collectPendingToolResultContinuations(
            resumeState,
            input.messages,
          );
          if (toolResultContinuations) {
            return {
              session,
              stream: await agent.continueStream({
                session,
                toolResultContinuations,
                ...abort,
              }),
            };
          }
        } else {
          const latestMessage = input.messages.at(-1);
          const resumePrompt = latestMessage
            ? buildHarnessPrompt([latestMessage])
            : "";
          if (resumePrompt) {
            return {
              session,
              stream: await agent.stream({
                session,
                prompt: resumePrompt,
                ...abort,
              }),
            };
          }
        }
        // The resumed session cannot drive this turn; discard it.
        await session.destroy().catch(() => undefined);
      } catch (error) {
        await session.destroy().catch(() => undefined);
        if (isAbortError(error)) {
          throw error;
        }
      }
    }
  }

  const prompt = buildHarnessPrompt(input.messages);
  if (!prompt) {
    throw new Error("Harness turn requires at least one text message");
  }

  const session = await agent.createSession({
    sessionId: input.sessionId,
    ...abort,
  });
  return {
    session,
    stream: await agent.stream({ session, prompt, ...abort }),
  };
}

/**
 * Park the session so a future turn can resume it. Returns undefined (after
 * destroying the session) when parking fails or the turn errored — a wedged
 * runtime should not be resumed.
 */
async function stopSessionForResume(
  session: OpenAgentHarnessSession,
  finishReason: HarnessTurnResult["finishReason"],
): Promise<unknown> {
  if (finishReason === "error") {
    await session.destroy().catch(() => undefined);
    return undefined;
  }

  try {
    return await session.stop();
  } catch {
    await session.destroy().catch(() => undefined);
    return undefined;
  }
}

export async function runHarnessTurn(
  input: RunHarnessTurnInput,
): Promise<HarnessTurnResult> {
  await ensureGatewayApiKeyEnv();

  const inactiveTools = HARNESS_INACTIVE_TOOLS[input.harnessId];
  const agent = new HarnessAgent({
    harness: createHarnessAdapter(input.harnessId, input.modelId),
    instructions: HARNESS_INSTRUCTIONS[input.harnessId],
    tools: OPEN_AGENT_HARNESS_TOOLS,
    ...(inactiveTools ? { inactiveTools: [...inactiveTools] } : {}),
    permissionMode: "allow-all",
    toolApproval: {
      ask_user_question: "user-approval",
    },
    sandbox: input.sandboxProvider,
    onSandboxSession: async ({ session, sessionWorkDir, abortSignal }) => {
      await linkHarnessWorkingDirectory({
        session,
        sessionWorkDir,
        workingDirectory: input.workingDirectory,
        abortSignal,
      });
    },
  });
  const { session, stream } = await startHarnessTurn(agent, input);
  let sessionEnded = false;

  try {
    // Tee before transforming so each branch runs the tool-mapping transform
    // exactly once with its own state (assembleHarnessResponseMessage maps
    // its branch internally).
    const [rawOutboundStream, responseStream] = stream
      .toUIMessageStream({
        originalMessages: input.originalMessages as never,
        generateMessageId: () => input.messageId,
        sendStart: false,
        sendFinish: false,
      })
      .tee();
    const outboundStream = rawOutboundStream
      .pipeThrough(createOpenAgentToolMappingStream())
      .pipeThrough(createHarnessStepBoundaryStream());
    const lastOriginalMessage = input.originalMessages.at(-1);
    const responseMessagePromise = assembleHarnessResponseMessage(
      (responseStream as ReadableStream<HarnessUIMessageChunk>).pipeThrough(
        createHarnessStepBoundaryStream(),
      ),
      input.messageId,
      lastOriginalMessage,
    );
    // Silence the unhandled-rejection window: the assembly promise can reject
    // (terminateOnError) while the outbound drain loop is still awaiting the
    // network. The rejection is re-observed in Promise.all below.
    responseMessagePromise.catch(() => undefined);

    const outboundReader = outboundStream.getReader();
    while (true) {
      const { done, value } = await outboundReader.read();
      if (done) {
        break;
      }
      await input.onChunk(value as HarnessUIMessageChunk);
    }

    const [
      responseMessage,
      finishReason,
      rawFinishReason,
      totalUsage,
      providerMetadata,
    ] = await Promise.all([
      responseMessagePromise,
      stream.finishReason,
      stream.rawFinishReason,
      stream.totalUsage,
      stream.providerMetadata,
    ]);
    const usage = toHarnessUsage(totalUsage, providerMetadata);
    const result = {
      finishReason,
      rawFinishReason,
      usage,
    } satisfies Omit<HarnessTurnResult, "responseMessage">;

    const enrichedResponseMessage = withHarnessMetadata(
      responseMessage,
      input,
      result,
    );
    await input.onChunk({
      type: "message-metadata",
      messageMetadata: enrichedResponseMessage.metadata,
    });

    const resumeState = await stopSessionForResume(session, finishReason);
    sessionEnded = true;

    return {
      ...result,
      responseMessage: enrichedResponseMessage,
      ...(resumeState !== undefined ? { resumeState } : {}),
    };
  } finally {
    if (!sessionEnded) {
      await session.destroy().catch(() => undefined);
    }
  }
}
