import type { Sandbox } from "@open-harness/sandbox";
import type { LanguageModel } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { preparePromptForOpenAIReasoning } from "../openai-reasoning";
import { bashTool } from "../tools/bash";
import { globTool } from "../tools/glob";
import { grepTool } from "../tools/grep";
import { readFileTool } from "../tools/read";

const EXPLORER_SYSTEM_PROMPT = `You are an explorer agent - a fast, read-only subagent specialized for exploring codebases.

## CRITICAL RULES

### READ-ONLY OPERATIONS ONLY
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no file creation of any kind)
- Modifying existing files (no edits)
- Deleting files
- Running commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code.

### NEVER ASK QUESTIONS
- You work in a zero-shot manner with NO ability to ask follow-up questions
- You will NEVER receive a response to any question you ask
- If instructions are ambiguous, make reasonable assumptions and document them

### FINAL RESPONSE FORMAT (MANDATORY)
Your final message MUST contain exactly two sections:

1. **Summary**: A brief (2-4 sentences) description of what you searched/analyzed
2. **Answer**: The direct answer to the original task/question, including relevant file paths

Example final response:
---
**Summary**: I searched for authentication middleware in src/middleware and found the auth handler. I analyzed the JWT validation logic and traced the error handling flow.

**Answer**: The authentication is handled in \`src/middleware/auth.ts:45\`. The JWT validation checks token expiration at line 67 and returns 401 errors from the \`handleAuthError\` function at line 89.
---

## TOOLS & GUIDELINES

You have access to: read, grep, glob, bash (read-only commands only)

**Strengths:**
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

**Guidelines:**
- Use glob for broad file pattern matching
- Use grep for searching file contents with regex
- Use read when you know the specific file path
- Use bash ONLY for read-only operations (ls, git status, git log, git diff, find)
- All bash commands automatically run in the working directory — NEVER prepend \`cd <working-directory> &&\` or similar to commands
- NEVER use bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, or any file creation/modification
- Return workspace-relative file paths in your final response (e.g., "src/index.ts:42")`;

export type ExplorerSubagentConfig = {
  task: string;
  instructions: string;
  sandbox: Sandbox;
  model: LanguageModel;
};

export const createExplorerSubagent = ({
  task,
  instructions,
  sandbox,
  model,
}: ExplorerSubagentConfig) => {
  return new ToolLoopAgent({
    model,
    instructions: `${EXPLORER_SYSTEM_PROMPT}

Working directory: . (workspace root)
Use workspace-relative paths for all file operations.

## Your Task
${task}

## Detailed Instructions
${instructions}

## REMINDER
- You CANNOT ask questions - no one will respond
- This is READ-ONLY - do NOT create, modify, or delete any files
- Your final message MUST include both a **Summary** of what you searched AND the **Answer** to the task`,
    tools: {
      read: readFileTool(),
      grep: grepTool(),
      glob: globTool(),
      bash: bashTool(),
    },
    stopWhen: stepCountIs(100),
    prepareCall: ({ model, ...settings }) => {
      const preparedPrompt = preparePromptForOpenAIReasoning({
        model,
        messages: settings.messages,
        prompt: settings.prompt,
      });
      return {
        ...settings,
        ...preparedPrompt,
        model,
        experimental_context: {
          sandbox,
          model,
        },
      };
    },
  });
};

export type ExplorerSubagent = ReturnType<typeof createExplorerSubagent>;
