import type { Suggestion } from "../components/suggestions";

export type SlashCommandAction = "open-model-select" | "open-resume";

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
 */
export function getCommandSuggestions(partialCommand: string): Suggestion[] {
  const query = partialCommand.toLowerCase();

  return slashCommands
    .filter((cmd) => cmd.name.toLowerCase().includes(query))
    .map((cmd) => ({
      value: cmd.name,
      display: `/${cmd.name}`,
      description: cmd.description,
    }));
}

/**
 * Get the command action for a given command name.
 */
export function getCommandAction(
  commandName: string,
): SlashCommandAction | null {
  const command = slashCommands.find(
    (cmd) => cmd.name.toLowerCase() === commandName.toLowerCase(),
  );
  return command?.action ?? null;
}
