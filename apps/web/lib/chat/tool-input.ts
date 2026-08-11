import {
  type AskUserQuestionInput,
  askUserQuestionInputSchema,
  type TodoItem,
  todoWriteInputSchema,
} from "@open-agents/shared/lib/chat-tools";

/**
 * Typed reads for chat tool inputs at render time. Both the open-agent loop
 * and the harness runner validate/normalize these inputs server-side before
 * chunks or messages reach the client, so a failed parse means the input is
 * not a complete payload (still-streaming partial input or a legacy persisted
 * part) — render sites treat `undefined` exactly like an empty input.
 */

export function parseTodoWriteInput(input: unknown): TodoItem[] | undefined {
  const parsed = todoWriteInputSchema.safeParse(input);
  return parsed.success ? parsed.data.todos : undefined;
}

export function parseAskUserQuestionInput(
  input: unknown,
): AskUserQuestionInput | undefined {
  const parsed = askUserQuestionInputSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}
