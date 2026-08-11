import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { AiSdkHarnessSandboxProvider } from "@open-agents/sandbox/vercel";
import type { FinishReason, UIMessage, UIMessageChunk } from "ai";
import { createHarnessAdapter, HARNESS_DEFINITIONS } from "./adapters.ts";
import { ensureGatewayApiKeyEnv } from "./auth.ts";
import {
  assembleHarnessResponseMessage,
  createHarnessStepBoundaryStream,
  createOpenAgentToolMappingStream,
} from "./chunk-streams.ts";
import {
  classifyHarnessErrorCode,
  type HarnessTurnErrorCode,
} from "./errors.ts";
import type { ExternalHarnessId } from "./ids.ts";
import { HARNESS_INSTRUCTIONS } from "./instructions.ts";
import { buildHarnessPrompt } from "./prompt.ts";
import {
  collectPendingToolResultContinuations,
  parseHarnessResumeState,
} from "./session-resume.ts";
import { OPEN_AGENT_HARNESS_TOOLS } from "./tools.ts";
import {
  toHarnessUsage,
  withHarnessMetadata,
  type HarnessUsage,
} from "./usage.ts";
import { linkHarnessWorkingDirectory } from "./workspace.ts";

export type HarnessTurnResult = {
  responseMessage: UIMessage;
  finishReason: FinishReason;
  rawFinishReason?: string;
  /**
   * Machine-readable classification of known failure modes, set when the raw
   * finish reason matches one. See `HarnessTurnErrorCode`.
   */
  errorCode?: HarnessTurnErrorCode;
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
  messages: UIMessage[];
  originalMessages: UIMessage[];
  selectedModelId: string;
  modelId: string;
  /** Session state returned by a previous turn's `resumeState`, if any. */
  resumeState?: unknown;
  abortSignal?: AbortSignal;
  onChunk: (chunk: UIMessageChunk) => Promise<void> | void;
};

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
 * results (answered questions) or prompting only the newest message.
 *
 * A fresh session primed with the full transcript is only used when the
 * resume state cannot produce a session at all (recreated sandbox, harness
 * update, forked chat — the documented `createSession` failure invariant) or
 * when the resumed session cannot drive this turn. Failures while starting
 * the turn on a successfully resumed session are genuine errors and
 * propagate; replaying the transcript there could re-execute side effects.
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
      } catch (error) {
        await session.destroy().catch(() => undefined);
        if (!isAbortError(error)) {
          console.error(
            `[harness-runner] Failed to start the turn on resumed ${input.harnessId} session ${input.sessionId}; propagating instead of replaying the transcript:`,
            error,
          );
        }
        throw error;
      }
      // The resumed session cannot drive this turn; discard it and fall
      // through to a fresh session.
      await session.destroy().catch(() => undefined);
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
  finishReason: FinishReason,
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

  const inactiveTools = HARNESS_DEFINITIONS[input.harnessId].inactiveTools;
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
    // Run the transforms once, then tee: the outbound branch and the
    // response-assembly branch consume identical, already-normalized chunks.
    const [outboundStream, responseStream] = stream
      .toUIMessageStream({
        originalMessages: input.originalMessages,
        generateMessageId: () => input.messageId,
        sendStart: false,
        sendFinish: false,
      })
      .pipeThrough(createOpenAgentToolMappingStream())
      .pipeThrough(createHarnessStepBoundaryStream())
      .tee();
    const lastOriginalMessage = input.originalMessages.at(-1);
    const responseMessagePromise = assembleHarnessResponseMessage(
      responseStream,
      input.messageId,
      lastOriginalMessage,
    );
    // Silence the unhandled-rejection window: the assembly promise can reject
    // (terminateOnError) while the outbound drain loop is still awaiting the
    // network. The rejection is re-observed in Promise.all below.
    responseMessagePromise.catch(() => undefined);

    // Await each onChunk before the next read so a slow consumer applies
    // backpressure to the harness instead of buffering the whole turn.
    const outboundReader = outboundStream.getReader();
    while (true) {
      const { done, value } = await outboundReader.read();
      if (done) {
        break;
      }
      await input.onChunk(value);
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
    const usage = toHarnessUsage(totalUsage, input.harnessId, providerMetadata);
    const errorCode = classifyHarnessErrorCode(rawFinishReason);
    const result = {
      finishReason,
      rawFinishReason,
      ...(errorCode ? { errorCode } : {}),
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
