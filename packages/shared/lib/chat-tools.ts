import { z } from "zod";

/**
 * Canonical schemas for the chat tool contract shared by the open-agent
 * loop (`packages/agent`), external harnesses (`packages/harness-runner`),
 * and the web UI renderers. All three surfaces must agree on these shapes:
 * tool parts are persisted and rendered by the same components regardless
 * of which engine produced them.
 */

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time.",
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export const todoWriteInputSchema = z.object({
  todos: z
    .array(todoItemSchema)
    .describe("The complete list of todo items. This replaces existing todos."),
});
export type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;

const askUserQuestionOptionSchema = z.object({
  label: z.string().describe("1-5 words, concise choice text"),
  description: z.string().describe("Explanation of trade-offs/implications"),
});

export const askUserQuestionQuestionSchema = z.object({
  question: z.string().describe("The complete question to ask, ends with '?'"),
  header: z.string().max(12).describe("Short label for tab/chip display"),
  options: z.array(askUserQuestionOptionSchema).min(2).max(4),
  multiSelect: z.boolean().default(false),
});

export const askUserQuestionInputSchema = z.object({
  questions: z.array(askUserQuestionQuestionSchema).min(1).max(4),
});
export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;

const answerValueSchema = z.string().or(z.array(z.string()));

export const askUserQuestionOutputSchema = z
  .object({
    answers: z.record(z.string(), answerValueSchema),
  })
  .or(
    z.object({
      declined: z.literal(true),
    }),
  );
export type AskUserQuestionOutput = z.infer<typeof askUserQuestionOutputSchema>;

/**
 * Render an ask_user_question output the way the model should read it back.
 * Shared so the harness bridge and the agent tool report answers identically.
 */
export function formatAskUserQuestionAnswers(
  output: AskUserQuestionOutput | undefined,
): string {
  if (!output) {
    return "User did not respond to questions.";
  }

  if ("declined" in output && output.declined) {
    return "User declined to answer questions. You should continue without this information or ask in a different way.";
  }

  if ("answers" in output) {
    const formattedAnswers = Object.entries(output.answers)
      .map(([question, answer]) => {
        const answerStr = Array.isArray(answer) ? answer.join(", ") : answer;
        return `"${question}"="${answerStr}"`;
      })
      .join(", ");
    return `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`;
  }

  return "User responded to questions.";
}
