import { ToolLoopAgent, stepCountIs } from "ai";
import { z } from "zod";
import { readFileTool } from "../../file-system/read";
import { writeFileTool, editFileTool } from "../../file-system/write";
import { grepTool } from "../../file-system/grep";
import { globTool } from "../../file-system/glob";
import { bashTool, commandNeedsApproval } from "../../file-system/bash";
import type { Sandbox } from "../../../sandbox";

const EXECUTOR_SYSTEM_PROMPT = `You are an executor agent - a fire-and-forget subagent that completes specific, well-defined implementation tasks autonomously.

Think of yourself as a productive engineer who cannot ask follow-up questions once started.

## CRITICAL RULES

### NEVER ASK QUESTIONS
- You work in a zero-shot manner with NO ability to ask follow-up questions
- You will NEVER receive a response to any question you ask
- If instructions are ambiguous, make reasonable assumptions and document them
- If you encounter blockers, work around them or document them in your final response

### ALWAYS COMPLETE THE TASK
- Execute the task fully from start to finish
- Do not stop mid-task or hand back partial work
- If one approach fails, try alternative approaches before giving up

### FINAL RESPONSE FORMAT (MANDATORY)
Your final message MUST contain exactly two sections:

1. **Summary**: A brief (2-4 sentences) description of what you actually did
2. **Answer**: The direct answer to the original task/question

Example final response:
---
**Summary**: I created the new user authentication module with JWT validation. I added the auth middleware, updated the routes, and created unit tests.

**Answer**: The authentication system is now implemented:
- \`src/middleware/auth.ts\` - JWT validation middleware
- \`src/routes/auth.ts\` - Login/logout endpoints
- \`src/tests/auth.test.ts\` - Unit tests (all passing)
---

## TOOLS
You have full access to file operations (read, write, edit, grep, glob) and bash commands. Use them to complete your task.`;

const callOptionsSchema = z.object({
  task: z.string().describe("Short description of the task"),
  instructions: z.string().describe("Detailed instructions for the task"),
  sandbox: z
    .custom<Sandbox>()
    .describe("Sandbox for file system and shell operations"),
});

export type ExecutorCallOptions = z.infer<typeof callOptionsSchema>;

export const executorSubagent = new ToolLoopAgent({
  model: "anthropic/claude-haiku-4.5",
  instructions: EXECUTOR_SYSTEM_PROMPT,
  tools: {
    read: readFileTool(),
    write: writeFileTool({ needsApproval: false }),
    edit: editFileTool({ needsApproval: false }),
    grep: grepTool(),
    glob: globTool(),
    // Use smart approval: safe read-only commands run without approval,
    // dangerous commands (rm, git push, etc.) still require approval
    bash: bashTool({
      needsApproval: ({ command }) => commandNeedsApproval(command),
    }),
  },
  stopWhen: stepCountIs(30),
  callOptionsSchema,
  prepareCall: ({ options, ...settings }) => {
    const sandbox = options.sandbox;
    return {
      ...settings,
      instructions: `${EXECUTOR_SYSTEM_PROMPT}

Working directory: ${sandbox.workingDirectory}

## Your Task
${options.task}

## Detailed Instructions
${options.instructions}

## REMINDER
- You CANNOT ask questions - no one will respond
- Complete the task fully before returning
- Your final message MUST include both a **Summary** of what you did AND the **Answer** to the task`,
      experimental_context: { sandbox },
    };
  },
});
