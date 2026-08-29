import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import {
  normalizeAskUserQuestionInput,
  normalizeTodoWriteInput,
} from "./normalize-tool-input.ts";

/**
 * Open Agents tool names the harness bridge reports as dynamic tools but the
 * web UI renders as first-class (static) tool parts.
 */
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

/**
 * Map a known Open Agents tool chunk from the bridge's dynamic-tool shape to
 * a static tool chunk. Unknown tools keep their dynamic flag.
 */
export function mapOpenAgentToolChunk(chunk: UIMessageChunk): UIMessageChunk {
  if (
    (chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error") &&
    chunk.dynamic === true &&
    isOpenAgentToolName(chunk.toolName)
  ) {
    const { dynamic: _dynamic, ...mappedChunk } = chunk;
    return mappedChunk;
  }

  return chunk;
}

/**
 * Rewrite the untrusted inputs harnesses provide for the interactive Open
 * Agents tools into the shared, validated chat-tool shapes. Runs once,
 * server-side, so streamed chunks and persisted parts agree.
 */
export function normalizeToolInputChunk(chunk: UIMessageChunk): UIMessageChunk {
  if (
    chunk.type !== "tool-input-available" &&
    chunk.type !== "tool-input-error"
  ) {
    return chunk;
  }

  if (chunk.toolName === "todo_write") {
    return { ...chunk, input: normalizeTodoWriteInput(chunk.input) };
  }
  if (chunk.toolName === "ask_user_question") {
    return { ...chunk, input: normalizeAskUserQuestionInput(chunk.input) };
  }
  return chunk;
}

/**
 * The full per-turn chunk mapping: static-tool mapping, tool-input
 * normalization, and suppression of approval requests for ask_user_question
 * (the question part itself is the approval surface in the web UI).
 */
export function createOpenAgentToolMappingStream(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
> {
  const pausedQuestionToolCallIds = new Set<string>();

  return new TransformStream({
    transform(chunk, controller) {
      if (
        (chunk.type === "tool-input-start" ||
          chunk.type === "tool-input-available" ||
          chunk.type === "tool-input-error") &&
        chunk.toolName === "ask_user_question"
      ) {
        pausedQuestionToolCallIds.add(chunk.toolCallId);
      }

      if (
        chunk.type === "tool-approval-request" &&
        pausedQuestionToolCallIds.has(chunk.toolCallId)
      ) {
        return;
      }

      controller.enqueue(normalizeToolInputChunk(mapOpenAgentToolChunk(chunk)));
    },
  });
}

/**
 * Harness streams start mid-step (sendStart is disabled); prepend the
 * missing step boundary so message assembly opens a fresh step.
 */
export function createHarnessStepBoundaryStream(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
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

/**
 * Fold an already-prepared UI message stream (mapped and step-bounded — see
 * `runHarnessTurn`) into the assistant response message to persist.
 */
export async function assembleHarnessResponseMessage(
  stream: ReadableStream<UIMessageChunk>,
  messageId: string,
  seedMessage?: UIMessage,
): Promise<UIMessage> {
  // Seed with the persisted assistant message on continuation turns so the
  // assembled message keeps earlier parts and metadata instead of replacing
  // the stored row with only this turn's output.
  let responseMessage: UIMessage =
    seedMessage &&
    seedMessage.role === "assistant" &&
    seedMessage.id === messageId
      ? { ...seedMessage, parts: [...seedMessage.parts] }
      : {
          id: messageId,
          role: "assistant",
          parts: [],
        };

  for await (const message of readUIMessageStream({
    message: responseMessage,
    stream,
    terminateOnError: true,
  })) {
    responseMessage = message;
  }

  return responseMessage;
}
