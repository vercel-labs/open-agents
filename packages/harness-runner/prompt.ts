import {
  askUserQuestionOutputSchema,
  formatAskUserQuestionAnswers,
} from "@open-agents/shared/lib/chat-tools";
import {
  getToolName,
  isToolUIPart,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";

type HarnessMessagePart = UIMessagePart<UIDataTypes, UITools>;

const MAX_COMPACT_OUTPUT_LENGTH = 2_000;

function stringifyCompact(value: unknown): string {
  const serialized = JSON.stringify(value) ?? String(value);
  return serialized.length > MAX_COMPACT_OUTPUT_LENGTH
    ? `${serialized.slice(0, MAX_COMPACT_OUTPUT_LENGTH)}...`
    : serialized;
}

function formatAskUserQuestionOutput(output: unknown): string | null {
  const parsed = askUserQuestionOutputSchema.safeParse(output);
  return parsed.success ? formatAskUserQuestionAnswers(parsed.data) : null;
}

function textFromToolPart(part: HarnessMessagePart): string | null {
  if (!isToolUIPart(part)) {
    return null;
  }
  const toolName = getToolName(part);

  if (part.state === "approval-responded") {
    if (part.approval.approved) {
      return `User approved the ${toolName} tool call.`;
    }
    const reason =
      typeof part.approval.reason === "string"
        ? ` Reason: ${part.approval.reason}`
        : "";
    return `User denied the ${toolName} tool call.${reason}`;
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

  // Persisted wire data can omit the output despite the declared state.
  if (!("output" in part)) {
    return null;
  }

  return `${toolName} tool output: ${stringifyCompact(part.output)}`;
}

function textFromPart(part: HarnessMessagePart): string | null {
  if (part.type === "text" && typeof part.text === "string") {
    return part.text;
  }

  if (part.type === "data-snippet" && typeof part.data === "object") {
    return JSON.stringify(part.data);
  }

  return textFromToolPart(part);
}

/**
 * Flatten a chat transcript into the plain-text prompt an external harness
 * receives: text parts, snippet data, and completed tool interactions.
 */
export function buildHarnessPrompt(messages: UIMessage[]): string {
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
