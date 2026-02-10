import type { SkillMetadata } from "@open-harness/agent";
import type { Suggestion } from "../components/suggestions";

export type SlashCommandAction =
  | "open-model-select"
  | "open-resume"
  | "new-chat"
  | { type: "invoke-skill"; skillName: string };

export type SlashCommand = {
  name: string;
  description: string;
  action: SlashCommandAction;
};

export const slashCommands: SlashCommand[] = [
  {
    name: "model",
    description: "Select the AI model",
    action: "open-model-select",
  },
  {
    name: "resume",
    description: "Resume a previous session",
    action: "open-resume",
  },
  {
    name: "new",
    description: "Start a new chat",
    action: "new-chat",
  },
];

/**
 * Extract a slash command from input text.
 * Only triggers when "/" is at the start of input.
 * Returns the partial command being typed or null if not in a command.
 */
export function extractSlashCommand(
  text: string,
  cursorPosition: number,
): { commandStart: number; partialCommand: string } | null {
  // Only trigger at the start of input
  if (!text.startsWith("/")) {
    return null;
  }

  // Find end of command (first space or cursor position)
  let commandEnd = text.indexOf(" ");
  if (commandEnd === -1 || commandEnd > cursorPosition) {
    commandEnd = cursorPosition;
  }

  // If cursor is past the command part, don't show suggestions
  if (cursorPosition > commandEnd && text.indexOf(" ") !== -1) {
    return null;
  }

  const partialCommand = text.slice(1, commandEnd);
  return { commandStart: 0, partialCommand };
}

/**
 * Get command suggestions matching a partial command.
 * Merges built-in commands with user-invocable skills, sorted alphabetically.
 */
export function getCommandSuggestions(
  partialCommand: string,
  skills: SkillMetadata[] = [],
): Suggestion[] {
  const query = partialCommand.toLowerCase();

  // Filter built-in commands
  const commandSuggestions = slashCommands
    .filter((cmd) => cmd.name.toLowerCase().includes(query))
    .map((cmd) => ({
      value: cmd.name,
      display: `/${cmd.name}`,
      description: cmd.description,
    }));

  // Filter user-invocable skills
  const skillSuggestions = skills
    .filter((skill) => skill.options.userInvocable !== false)
    .filter((skill) => skill.name.toLowerCase().includes(query))
    .map((skill) => ({
      value: skill.name,
      display: `/${skill.name}`,
      description: skill.description,
    }));

  // Merge and sort alphabetically by value
  return [...commandSuggestions, ...skillSuggestions].toSorted((a, b) =>
    a.value.localeCompare(b.value),
  );
}

/**
 * Get the command action for a given command name.
 * Checks built-in commands first, then falls back to skills.
 */
export function getCommandAction(
  commandName: string,
  skills: SkillMetadata[] = [],
): SlashCommandAction | null {
  // Check built-in commands first
  const command = slashCommands.find(
    (cmd) => cmd.name.toLowerCase() === commandName.toLowerCase(),
  );
  if (command) {
    return command.action;
  }

  // Check skills
  const skill = skills.find(
    (s) =>
      s.name.toLowerCase() === commandName.toLowerCase() &&
      s.options.userInvocable !== false,
  );
  if (skill) {
    return { type: "invoke-skill", skillName: skill.name };
  }

  return null;
}
