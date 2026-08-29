import type {
  HarnessAgentResumeSessionState,
  HarnessAgentToolResultContinuation,
} from "@ai-sdk/harness/agent";
import { z } from "zod";

type MessageWithParts = {
  role: string;
  parts: Array<Record<string, unknown>>;
};

const lifecycleStateBaseShape = {
  harnessId: z.string(),
  specificationVersion: z.literal("harness-v1"),
  /** Adapter-defined payload; opaque to the runner but must be JSON. */
  data: z.json(),
};

const pendingToolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.string(),
});

const pendingToolApprovalSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.string(),
  kind: z.enum(["builtin", "custom"]),
  providerExecuted: z.boolean().optional(),
  nativeName: z.string().optional(),
});

const continueTurnStateSchema = z.object({
  ...lifecycleStateBaseShape,
  type: z.literal("continue-turn"),
  pendingToolApprovals: z.array(pendingToolApprovalSchema).optional(),
  pendingToolResults: z.array(pendingToolResultSchema).optional(),
});

const resumeSessionStateSchema = z.object({
  ...lifecycleStateBaseShape,
  type: z.literal("resume-session"),
  continueFrom: continueTurnStateSchema.optional(),
});

/**
 * Validate a persisted harness session resume payload. Returns undefined for
 * anything that is not a resume-session state produced by the same harness,
 * so the caller falls back to a fresh session. On success the original value
 * is returned (not the parsed clone) so adapter-defined fields survive.
 */
export function parseHarnessResumeState(
  value: unknown,
  harnessId: string,
): HarnessAgentResumeSessionState | undefined {
  const parsed = resumeSessionStateSchema.safeParse(value);
  if (!parsed.success || parsed.data.harnessId !== harnessId) {
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
