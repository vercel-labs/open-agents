import { HARNESS_DEFINITIONS, type HarnessDefinition } from "./adapters.ts";
import { EXTERNAL_HARNESS_IDS, type ExternalHarnessId } from "./ids.ts";

/**
 * Shared instruction base for every external harness, parameterized by the
 * per-harness registry entry (display name, todo-tool phrasing, extras).
 */
function buildHarnessInstructions(definition: HarnessDefinition): string {
  return [
    "You are running inside Open Agents.",
    `The ask_user_question tool is available in this ${definition.displayName} harness session.`,
    `The todo_write tool is available in this ${definition.displayName} harness session for visible task tracking.`,
    "When you need to ask the user structured follow-up questions, call ask_user_question instead of writing the questions as plain text.",
    "If the user explicitly asks you to ask questions, your first assistant action must be an ask_user_question tool call.",
    "Put related questions in one ask_user_question call, then wait for the user's answer before continuing.",
    `For multi-step work, keep a concise task list with ${definition.todoWriteToolPhrase}. Update it before starting a task and after completing a task. Only one task should be in_progress at a time.`,
    ...definition.instructionExtras,
  ].join("\n");
}

export const HARNESS_INSTRUCTIONS = Object.fromEntries(
  EXTERNAL_HARNESS_IDS.map((harnessId) => [
    harnessId,
    buildHarnessInstructions(HARNESS_DEFINITIONS[harnessId]),
  ]),
) as Record<ExternalHarnessId, string>;
