import type {
  HarnessAgentResumeSessionState,
  HarnessAgentToolResultContinuation,
} from "@ai-sdk/harness/agent";

type MessageWithParts = {
  role: string;
  parts: Array<Record<string, unknown>>;
};

/**
 * Validate a persisted harness session resume payload. Returns undefined for
 * anything that is not a resume-session state produced by the same harness,
 * so the caller falls back to a fresh session.
 */
export function parseHarnessResumeState(
  value: unknown,
  harnessId: string,
): HarnessAgentResumeSessionState | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const state = value as { type?: unknown; harnessId?: unknown };
  if (state.type !== "resume-session" || state.harnessId !== harnessId) {
    return undefined;
  }

  return value as HarnessAgentResumeSessionState;
}

function findToolOutput(
  messages: MessageWithParts[],
  toolCallId: string,
): unknown {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (
        part.toolCallId === toolCallId &&
        part.state === "output-available" &&
        "output" in part
      ) {
        return part.output;
      }
    }
  }

  return undefined;
}

/**
 * Build tool-result continuations for a resumed session with an unfinished
 * turn (paused on a client tool such as ask_user_question). Returns undefined
 * when any pending result has no answer in the chat history yet — the caller
 * must then fall back to a fresh session instead of continuing.
 */
export function collectPendingToolResultContinuations(
  resumeState: HarnessAgentResumeSessionState,
  messages: MessageWithParts[],
): HarnessAgentToolResultContinuation[] | undefined {
  const pendingToolResults = resumeState.continueFrom?.pendingToolResults ?? [];
  if (pendingToolResults.length === 0) {
    return undefined;
  }

  const continuations: HarnessAgentToolResultContinuation[] = [];
  for (const pending of pendingToolResults) {
    const output = findToolOutput(messages, pending.toolCallId);
    if (output === undefined) {
      return undefined;
    }
    continuations.push({ toolCallId: pending.toolCallId, output });
  }

  return continuations;
}
