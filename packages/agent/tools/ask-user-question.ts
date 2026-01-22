import { tool, type UIToolInvocation } from "ai";
import { z } from "zod";

const optionSchema = z.object({
  label: z.string().describe("1-5 words, concise choice text"),
  description: z.string().describe("Explanation of trade-offs/implications"),
});

const questionSchema = z.object({
  question: z.string().describe("The complete question to ask, ends with '?'"),
  header: z.string().max(12).describe("Short label for tab/chip display"),
  options: z.array(optionSchema).min(2).max(4),
  multiSelect: z.boolean().default(false),
});

export const askUserQuestionInputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(4),
});

export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;

// Output schema for the client-side tool
const answerValueSchema = z.string().or(z.array(z.string()));
const askUserQuestionOutputSchema = z
  .object({
    answers: z.record(z.string(), answerValueSchema),
  })
  .or(
    z.object({
      declined: z.literal(true),
    }),
  );

export type AskUserQuestionOutput = z.infer<typeof askUserQuestionOutputSchema>;

export const askUserQuestionTool = tool({
  description: `Ask the user questions during execution to gather preferences, clarify requirements, or get decisions.

WHEN TO USE:
- Gather user preferences or requirements
- Clarify ambiguous instructions
- Get decisions on implementation choices
- Offer choices about direction to take

USAGE NOTES:
- Users can always select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers
- If you recommend a specific option, make it the first option and add "(Recommended)"
- Questions appear as tabs; users navigate between them before submitting`,
  inputSchema: askUserQuestionInputSchema,
  outputSchema: askUserQuestionOutputSchema,
  // NO execute function - this is a client-side tool
  toModelOutput: ({ output }) => {
    if (!output) {
      return { type: "text", value: "User did not respond to questions." };
    }

    if ("declined" in output && output.declined) {
      return {
        type: "text",
        value:
          "User declined to answer questions. You should continue without this information or ask in a different way.",
      };
    }

    if ("answers" in output) {
      const formattedAnswers = Object.entries(output.answers)
        .map(([question, answer]) => {
          const answerStr = Array.isArray(answer) ? answer.join(", ") : answer;
          return `"${question}"="${answerStr}"`;
        })
        .join(", ");

      return {
        type: "text",
        value: `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`,
      };
    }

    return { type: "text", value: "User responded to questions." };
  },
});

export type AskUserQuestionToolUIPart = UIToolInvocation<
  typeof askUserQuestionTool
>;
