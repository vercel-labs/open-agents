import {
  askUserQuestionQuestionSchema,
  todoWriteInputSchema,
  type AskUserQuestionInput,
  type TodoItem,
  type TodoStatus,
  type TodoWriteInput,
} from "@open-agents/shared/lib/chat-tools";
import { z } from "zod";

/**
 * Harness tool inputs arrive over the bridge as untyped JSON and can be
 * malformed: stringified nested JSON, a single object where an array is
 * expected, missing fields, over-long headers. This module coerces whatever
 * arrived into the shared chat-tool shapes once, server-side, so every
 * `tool-input-available` chunk and persisted message part leaving the runner
 * carries a well-formed input. Unsalvageable entries are dropped.
 */

const MAX_QUESTION_HEADER_LENGTH = 12;

const TODO_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
]);

type Question = AskUserQuestionInput["questions"][number];
type QuestionOption = Question["options"][number];

/**
 * Renderable superset of the shared ask_user_question input schema: the
 * item shapes are identical, but the model-facing cardinality constraints
 * (1-4 questions, 2-4 options) are relaxed because repaired inputs may
 * legitimately carry fewer entries and must still render.
 */
const renderableAskUserQuestionInputSchema = z.object({
  questions: z.array(
    askUserQuestionQuestionSchema.extend({
      options: z.array(askUserQuestionQuestionSchema.shape.options.element),
    }),
  ),
});

/** Coerce an untrusted todo_write input into a valid `TodoWriteInput`. */
export function normalizeTodoWriteInput(input: unknown): TodoWriteInput {
  const coerced = { todos: coerceTodos(input) };
  const parsed = todoWriteInputSchema.safeParse(coerced);
  return parsed.success ? parsed.data : { todos: [] };
}

/**
 * Coerce an untrusted ask_user_question input into renderable questions
 * matching the shared item schema (cardinality constraints relaxed).
 */
export function normalizeAskUserQuestionInput(
  input: unknown,
): AskUserQuestionInput {
  const coerced = { questions: coerceQuestions(input) };
  const parsed = renderableAskUserQuestionInputSchema.safeParse(coerced);
  return parsed.success ? parsed.data : { questions: [] };
}

function coerceTodos(input: unknown): TodoItem[] {
  const root = parseMaybeJson(input);
  const rawTodos = Array.isArray(root)
    ? root
    : isRecord(root)
      ? parseMaybeJson(root.todos)
      : [];
  const list = Array.isArray(rawTodos)
    ? rawTodos
    : isRecord(rawTodos)
      ? [rawTodos]
      : [];

  return list.map(coerceTodo).filter((todo): todo is TodoItem => todo !== null);
}

function coerceTodo(value: unknown, index: number): TodoItem | null {
  const parsed = parseMaybeJson(value);

  if (typeof parsed === "string") {
    const content = parsed.trim();
    return content ? { id: `todo-${index}`, content, status: "pending" } : null;
  }

  if (!isRecord(parsed) || typeof parsed.content !== "string") {
    return null;
  }

  const content = parsed.content.trim();
  if (!content) {
    return null;
  }

  return {
    id:
      typeof parsed.id === "string" && parsed.id.trim()
        ? parsed.id.trim()
        : `todo-${index}`,
    content,
    status: isTodoStatus(parsed.status) ? parsed.status : "pending",
  };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && TODO_STATUSES.has(value as TodoStatus);
}

function coerceQuestions(input: unknown): Question[] {
  const root = parseMaybeJson(input);
  if (!isRecord(root)) {
    return [];
  }

  const rawQuestions = parseMaybeJson(root.questions);
  const list = Array.isArray(rawQuestions)
    ? rawQuestions
    : isRecord(rawQuestions)
      ? [rawQuestions]
      : [];

  return list
    .map(coerceQuestion)
    .filter((question): question is Question => question !== null);
}

function coerceQuestion(value: unknown): Question | null {
  const record = parseMaybeJson(value);
  if (!isRecord(record) || typeof record.question !== "string") {
    return null;
  }
  const question = record.question.trim();
  if (!question) {
    return null;
  }

  const rawOptions = parseMaybeJson(record.options);
  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map(coerceOption)
    .filter((option): option is QuestionOption => option !== null);

  return {
    question,
    header:
      typeof record.header === "string" && record.header.trim()
        ? record.header.trim().slice(0, MAX_QUESTION_HEADER_LENGTH)
        : question.slice(0, MAX_QUESTION_HEADER_LENGTH),
    options,
    multiSelect: record.multiSelect === true,
  };
}

function coerceOption(value: unknown): QuestionOption | null {
  const record = parseMaybeJson(value);
  if (isRecord(record) && typeof record.label === "string" && record.label) {
    return {
      label: record.label,
      description:
        typeof record.description === "string" ? record.description : "",
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { label: value.trim(), description: "" };
  }
  return null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
