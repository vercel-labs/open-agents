import { tool, type UIToolInvocation } from "ai";
import {
  askUserQuestionInputSchema,
  askUserQuestionOutputSchema,
  formatAskUserQuestionAnswers,
} from "@open-agents/shared/lib/chat-tools";

export {
  askUserQuestionInputSchema,
  type AskUserQuestionInput,
  type AskUserQuestionOutput,
} from "@open-agents/shared/lib/chat-tools";

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
  toModelOutput: ({ output }) => ({
    type: "text",
    value: formatAskUserQuestionAnswers(output),
  }),
});

export type AskUserQuestionToolUIPart = UIToolInvocation<
  typeof askUserQuestionTool
>;
