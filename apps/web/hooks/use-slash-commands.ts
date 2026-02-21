import { useState, useMemo, useCallback, useEffect } from "react";
import type { SkillSuggestion } from "@/app/api/sessions/[sessionId]/skills/route";

interface UseSlashCommandsOptions {
  inputValue: string;
  cursorPosition: number;
  skills: SkillSuggestion[] | null;
  onSelect: (skillName: string, slashStart: number, cursorPos: number) => void;
}

interface UseSlashCommandsResult {
  showSlashCommands: boolean;
  slashSuggestions: SkillSuggestion[];
  selectedSlashIndex: number;
  handleSlashKeyDown: (e: React.KeyboardEvent) => boolean;
  slashInfo: { slashStart: number; partialCommand: string } | null;
  closeSlashCommands: () => void;
}

/**
 * Extract the / command from input text at the cursor position.
 * Only triggers when / is at position 0 or preceded by whitespace.
 */
export function extractSlashCommand(
  text: string,
  cursorPosition: number,
): { slashStart: number; partialCommand: string } | null {
  let slashIndex = -1;
  for (let i = cursorPosition - 1; i >= 0; i--) {
    const char = text[i];
    if (char === undefined) break;
    // Stop at whitespace — no slash command spans whitespace
    if (char === " " || char === "\t" || char === "\n") {
      break;
    }
    if (char === "/") {
      slashIndex = i;
      break;
    }
  }

  if (slashIndex === -1) {
    return null;
  }

  // / must be at the start of input or preceded by whitespace
  if (slashIndex > 0) {
    const preceding = text[slashIndex - 1];
    if (preceding !== " " && preceding !== "\t" && preceding !== "\n") {
      return null;
    }
  }

  const partialCommand = text.slice(slashIndex + 1, cursorPosition);
  return { slashStart: slashIndex, partialCommand };
}

/**
 * Filter skill suggestions based on a partial command string.
 */
export function filterSkillSuggestions(
  skills: SkillSuggestion[],
  partialCommand: string,
  maxResults: number = 20,
): SkillSuggestion[] {
  const query = partialCommand.toLowerCase();

  if (!query) {
    // Show all skills when just "/" is typed
    return skills.slice(0, maxResults);
  }

  const results: SkillSuggestion[] = [];
  for (const skill of skills) {
    if (skill.name.toLowerCase().includes(query)) {
      results.push(skill);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

export function useSlashCommands({
  inputValue,
  cursorPosition,
  skills,
  onSelect,
}: UseSlashCommandsOptions): UseSlashCommandsResult {
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Extract slash command info from current input/cursor
  const slashInfo = useMemo(() => {
    if (dismissed) return null;
    return extractSlashCommand(inputValue, cursorPosition);
  }, [inputValue, cursorPosition, dismissed]);

  // Filter suggestions based on partial command
  const slashSuggestions = useMemo(() => {
    if (!slashInfo || !skills) return [];
    return filterSkillSuggestions(skills, slashInfo.partialCommand);
  }, [slashInfo, skills]);

  const showSlashCommands = slashInfo !== null && slashSuggestions.length > 0;

  // Reset state when command changes
  const partialCommand = slashInfo?.partialCommand;
  useEffect(() => {
    setSelectedSlashIndex(0);
    setDismissed(false);
  }, [partialCommand]);

  const closeSlashCommands = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleSlashKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!showSlashCommands) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedSlashIndex((prev) =>
            prev < slashSuggestions.length - 1 ? prev + 1 : prev,
          );
          return true;

        case "ArrowUp":
          e.preventDefault();
          setSelectedSlashIndex((prev) => (prev > 0 ? prev - 1 : prev));
          return true;

        case "Tab":
        case "Enter": {
          const selected = slashSuggestions[selectedSlashIndex];
          if (selected && slashInfo) {
            e.preventDefault();
            onSelect(selected.name, slashInfo.slashStart, cursorPosition);
            setDismissed(true);
            return true;
          }
          return false;
        }

        case "Escape":
          e.preventDefault();
          setDismissed(true);
          return true;

        default:
          return false;
      }
    },
    [
      showSlashCommands,
      slashSuggestions,
      selectedSlashIndex,
      slashInfo,
      cursorPosition,
      onSelect,
    ],
  );

  return {
    showSlashCommands,
    slashSuggestions,
    selectedSlashIndex,
    handleSlashKeyDown,
    slashInfo,
    closeSlashCommands,
  };
}
