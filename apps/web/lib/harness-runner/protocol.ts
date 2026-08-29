import type {
  HarnessTurnResult,
  HarnessUIMessage,
  HarnessUIMessageChunk,
} from "@open-agents/harness-runner";
import { EXTERNAL_HARNESS_IDS } from "@open-agents/harness-runner/ids";
import type { SandboxState } from "@open-agents/sandbox";
import { z } from "zod";

/**
 * Wire protocol between the harness workflow step (client.ts) and the
 * internal harness-runner route. The HMAC signature already establishes a
 * trusted origin; these schemas exist for drift protection between the two
 * sides and as self-documentation, so nested payloads owned by other layers
 * (messages, sandbox state, turn results) get pragmatic structural checks
 * instead of full models.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const uiMessagesSchema = z.custom<HarnessUIMessage[]>(
  (value) =>
    Array.isArray(value) &&
    value.every(
      (message) =>
        isRecord(message) &&
        typeof message.id === "string" &&
        typeof message.role === "string" &&
        Array.isArray(message.parts),
    ),
  "Expected an array of UI messages",
);

const sandboxStateSchema = z.custom<SandboxState>(
  (value) => isRecord(value) && typeof value.type === "string",
  "Expected a sandbox state object",
);

export const internalHarnessRunRequestSchema = z.object({
  harnessId: z.enum(EXTERNAL_HARNESS_IDS),
  sandboxState: sandboxStateSchema,
  workingDirectory: z.string().min(1),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  messages: uiMessagesSchema,
  originalMessages: uiMessagesSchema,
  selectedModelId: z.string(),
  modelId: z.string(),
  /** Harness session state persisted from the previous turn, if any. */
  resumeState: z.unknown().optional(),
});

export type InternalHarnessRunRequest = z.infer<
  typeof internalHarnessRunRequestSchema
>;

const harnessTurnResultSchema = z.custom<HarnessTurnResult>(
  (value) =>
    isRecord(value) &&
    isRecord(value.responseMessage) &&
    typeof value.finishReason === "string",
  "Expected a harness turn result",
);

export const internalHarnessRunEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chunk"),
    chunk: z.custom<HarnessUIMessageChunk>(
      (value) => isRecord(value) && typeof value.type === "string",
      "Expected a UI message chunk",
    ),
  }),
  z.object({
    type: z.literal("result"),
    result: harnessTurnResultSchema,
  }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
  }),
]);

export type InternalHarnessRunEvent = z.infer<
  typeof internalHarnessRunEventSchema
>;
