import { isToolUIPart } from "ai";
import type { TodoItem } from "../../agent/types.js";
import type { TUIAgentUIMessage, TUIAgentUIToolPart } from "../types.js";

function isTodoWritePart(
  part: TUIAgentUIToolPart,
): part is TUIAgentUIToolPart & { type: "tool-todo_write" } {
  return part.type === "tool-todo_write";
}

export function extractTodosFromMessage(
  message: TUIAgentUIMessage,
): TodoItem[] | null {
  let latestTodos: TodoItem[] | null = null;
  for (const part of message.parts) {
    if (
      isToolUIPart(part) &&
      isTodoWritePart(part) &&
      part.state === "output-available" &&
      part.output
    ) {
      latestTodos = part.output.todos;
    }
  }
  return latestTodos;
}

export function extractTodosFromLastAssistantMessage(
  messages: TUIAgentUIMessage[],
): TodoItem[] | null {
  // Find the last user message index to separate current vs previous exchanges
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserMessageIndex = i;
      break;
    }
  }

  // First, look for todos in the current exchange (after last user message)
  for (let i = messages.length - 1; i > lastUserMessageIndex; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.role === "assistant") {
      const todos = extractTodosFromMessage(message);
      if (todos !== null) {
        return todos;
      }
    }
  }

  // No todos in current exchange - check the previous exchange for incomplete todos
  // Find the second-to-last user message to bound the previous exchange
  let prevUserMessageIndex = -1;
  for (let i = lastUserMessageIndex - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      prevUserMessageIndex = i;
      break;
    }
  }

  // Look for todos in the previous exchange only
  for (let i = lastUserMessageIndex - 1; i > prevUserMessageIndex; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.role === "assistant") {
      const todos = extractTodosFromMessage(message);
      if (todos !== null && todos.some((t) => t.status !== "completed")) {
        return todos;
      }
    }
  }

  return null;
}
