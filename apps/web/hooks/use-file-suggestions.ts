import { useState, useMemo, useCallback, useEffect } from "react";
import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";
import { extractMention, filterFileSuggestions } from "@/lib/file-suggestions";

interface UseFileSuggestionsOptions {
  inputValue: string;
  cursorPosition: number;
  files: FileSuggestion[] | null;
  onSelect: (value: string, mentionStart: number, cursorPos: number) => void;
}

interface UseFileSuggestionsResult {
  showSuggestions: boolean;
  suggestions: FileSuggestion[];
  selectedIndex: number;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  mentionInfo: { mentionStart: number; partialPath: string } | null;
  closeSuggestions: () => void;
}

export function useFileSuggestions({
  inputValue,
  cursorPosition,
  files,
  onSelect,
}: UseFileSuggestionsOptions): UseFileSuggestionsResult {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Extract mention info from current input/cursor
  const mentionInfo = useMemo(() => {
    if (dismissed) return null;
    return extractMention(inputValue, cursorPosition);
  }, [inputValue, cursorPosition, dismissed]);

  // Filter suggestions based on partial path
  const suggestions = useMemo(() => {
    if (!mentionInfo || !files) return [];
    return filterFileSuggestions(files, mentionInfo.partialPath);
  }, [mentionInfo, files]);

  // Reset selected index when suggestions change
  const showSuggestions = mentionInfo !== null && suggestions.length > 0;

  // Reset state when mention changes
  const partialPath = mentionInfo?.partialPath;
  useEffect(() => {
    setSelectedIndex(0);
    setDismissed(false);
  }, [partialPath]);

  const closeSuggestions = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!showSuggestions) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : prev,
          );
          return true;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          return true;

        case "Tab":
        case "Enter": {
          const selected = suggestions[selectedIndex];
          if (selected && mentionInfo) {
            e.preventDefault();
            onSelect(selected.value, mentionInfo.mentionStart, cursorPosition);
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
      showSuggestions,
      suggestions,
      selectedIndex,
      mentionInfo,
      cursorPosition,
      onSelect,
    ],
  );

  return {
    showSuggestions,
    suggestions,
    selectedIndex,
    handleKeyDown,
    mentionInfo,
    closeSuggestions,
  };
}
