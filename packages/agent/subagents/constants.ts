export const SUBAGENT_STEP_LIMIT = 100;

// ---------------------------------------------------------------------------
// Shared prompt fragments for subagents.
//
// These are composable building blocks. Each subagent picks the ones it needs
// and stitches them into its own system prompt.
// ---------------------------------------------------------------------------

/** Rules that apply to every subagent regardless of capabilities. */
export const SUBAGENT_NO_QUESTIONS_RULES = `### NEVER ASK QUESTIONS
- You work in a zero-shot manner with NO ability to ask follow-up questions
- You will NEVER receive a response to any question you ask
- If instructions are ambiguous, make reasonable assumptions and document them
- If you encounter blockers, work around them or document them in your final response`;

/** Rules for subagents that modify files (executor, design, etc.). */
export const SUBAGENT_COMPLETE_TASK_RULES = `### ALWAYS COMPLETE THE TASK
- Execute the task fully from start to finish
- Do not stop mid-task or hand back partial work
- If one approach fails, try alternative approaches before giving up`;

/**
 * Response format header shared by all subagents.
 * Each subagent appends its own example after this block.
 */
export const SUBAGENT_RESPONSE_FORMAT = `### FINAL RESPONSE FORMAT (MANDATORY)
Your final message MUST contain exactly two sections:

1. **Summary**: A brief (2-4 sentences) description of what you actually did
2. **Answer**: The direct answer to the original task/question`;

/** Validation rules for subagents that modify files. */
export const SUBAGENT_VALIDATE_RULES = `### VALIDATE YOUR CHANGES
- After making code changes, ALWAYS run available validation commands (typecheck, lint, CI scripts)
- Check AGENTS.md and \`package.json\` scripts for project-specific commands (e.g., \`bun run ci\`, \`turbo typecheck\`, \`turbo lint\`)
- NEVER run raw tool commands like \`npx tsc\`, \`tsc --noEmit\`, or \`eslint .\` -- always use the project's configured scripts
- Fix any errors or warnings your changes introduce before finishing
- Do not skip validation because a change seems small or trivial`;

/** Bash usage rules for subagents with shell access. */
export const SUBAGENT_BASH_RULES = `## BASH COMMANDS
- All bash commands automatically run in the working directory — NEVER prepend \`cd <working-directory> &&\` or similar to commands
- Just run the command directly (e.g., \`npm test\`)`;

/** Working directory context injected into prepareCall instructions. */
export const SUBAGENT_WORKING_DIR = `Working directory: . (workspace root)
Use workspace-relative paths for all file operations.`;

/** Reminder block appended at the end of prepareCall instructions for write-capable subagents. */
export const SUBAGENT_REMINDER = `## REMINDER
- You CANNOT ask questions - no one will respond
- Complete the task fully before returning
- Your final message MUST include both a **Summary** of what you did AND the **Answer** to the task`;
