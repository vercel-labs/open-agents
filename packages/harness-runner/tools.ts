import {
  askUserQuestionInputSchema,
  todoWriteInputSchema,
} from "@open-agents/shared/lib/chat-tools";
import { tool, type ToolSet } from "ai";
import { normalizeTodoWriteInput } from "./normalize-tool-input.ts";

/**
 * Open Agents tools exposed to every external harness. Input schemas are the
 * canonical shared zod schemas, so the harness bridge, the open-agent loop,
 * and the web renderers all agree on the tool contract.
 */
export const OPEN_AGENT_HARNESS_TOOLS = {
  ask_user_question: tool({
    description: `Ask the user structured questions during execution to gather preferences, clarify requirements, or get decisions.

Use this when the user asks you to ask questions, when requirements are ambiguous, or when the next step depends on a human choice.

Always use this lower-case ask_user_question tool. Never use Claude Code's built-in AskUserQuestion tool.

Users can select provided options or enter custom text.`,
    inputSchema: askUserQuestionInputSchema,
  }),
  todo_write: tool({
    description: `Create and manage a structured task list for the current session.

Use this for multi-step work, checklists, or when the user gives several requirements. This tool replaces the entire todo list, so always send the full updated list.

Only one todo should be in_progress at a time. Mark work in_progress before starting it and completed as soon as it is done.`,
    inputSchema: todoWriteInputSchema,
    // Harness bridges can deliver malformed inputs despite the declared
    // schema; normalize before reporting so the tool output is well-formed.
    execute: (input) => {
      const { todos } = normalizeTodoWriteInput(input);
      return Promise.resolve({
        success: true,
        message: `Updated task list with ${todos.length} items`,
        todos,
      });
    },
  }),
} satisfies ToolSet;
