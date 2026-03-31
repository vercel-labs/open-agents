import { isToolUIPart } from "ai";
import type { WebAgentUIMessage } from "@/app/types";
import { dedupeMessageReasoning } from "@/lib/chat/dedupe-message-reasoning";
import { upsertChatMessageScoped } from "@/lib/db/sessions";

/**
 * Persist assistant messages that contain client-side tool results
 * (e.g. ask_user_question responses, approval responses).
 *
 * When the client auto-submits after a tool result, the latest message is an
 * assistant message with tool parts in terminal state. Without eagerly
 * persisting this, the tool result only lands in the DB after the workflow
 * finishes — so switching devices mid-stream loses the tool result.
 *
 * NOTE: This file must NOT be imported from workflow code. The `ai` runtime
 * import would pull transitive CJS dependencies (e.g. `postgres`) into the
 * workflow VM where `require` is not available.
 */
export async function persistAssistantMessagesWithToolResults(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== "assistant") {
    return;
  }

  // Only persist if this assistant message actually has tool parts with
  // client-provided results (terminal states from client-side tools).
  const hasToolResults = latestMessage.parts.some(
    (part) =>
      isToolUIPart(part) &&
      (part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "approval-responded"),
  );

  if (!hasToolResults) {
    return;
  }

  try {
    const dedupedMessage = dedupeMessageReasoning(latestMessage);
    const result = await upsertChatMessageScoped({
      id: dedupedMessage.id,
      chatId,
      role: "assistant",
      parts: dedupedMessage,
    });

    if (result.status === "conflict") {
      console.warn(
        `Skipped assistant tool-result upsert due to ID scope conflict: ${latestMessage.id}`,
      );
    }
  } catch (error) {
    console.error(
      "Failed to persist assistant message with tool results:",
      error,
    );
  }
}
