import { type KeyEvent, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PRIMARY_COLOR } from "../lib/colors";
import { inputFromKey, isReturnKey } from "../lib/keyboard";

export type SettingsOption = {
  id: string;
  name: string;
  description?: string;
  meta?: string;
};

type SettingsPanelProps = {
  title: string;
  description?: string;
  options: SettingsOption[];
  currentId: string;
  onSelect: (id: string) => void;
  onCancel: () => void;
  maxVisible?: number;
};

export function SettingsPanel({
  title,
  description,
  options,
  currentId,
  onSelect,
  onCancel,
  maxVisible = 10,
}: SettingsPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Initialize selectedIndex based on currentId - only computed once on mount
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const index = options.findIndex((opt) => opt.id === currentId);
    return index !== -1 ? index : 0;
  });

  // Guard to prevent callbacks from firing during initial render
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
  }, []);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (opt) =>
        opt.id.toLowerCase().includes(query) ||
        opt.name.toLowerCase().includes(query) ||
        opt.description?.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  // Reset selection when search query changes
  useEffect(() => {
    // Find currentId in new filtered results, or default to 0
    const currentIndex = filteredOptions.findIndex(
      (opt) => opt.id === currentId,
    );
    const newIndex = currentIndex !== -1 ? currentIndex : 0;
    setSelectedIndex(newIndex);
  }, [searchQuery, filteredOptions, currentId]);

  // Calculate visible window of options
  const { visibleOptions, startIndex } = useMemo(() => {
    const total = filteredOptions.length;
    if (total <= maxVisible) {
      return { visibleOptions: filteredOptions, startIndex: 0 };
    }

    // Calculate window to keep selected item visible with context
    const halfWindow = Math.floor(maxVisible / 2);
    let start = selectedIndex - halfWindow;

    // Clamp to valid range
    if (start < 0) {
      start = 0;
    } else if (start + maxVisible > total) {
      start = total - maxVisible;
    }

    return {
      visibleOptions: filteredOptions.slice(start, start + maxVisible),
      startIndex: start,
    };
  }, [filteredOptions, selectedIndex, maxVisible]);

  // Use refs to access current values in the input handler without causing re-subscriptions
  const filteredOptionsRef = useRef(filteredOptions);
  filteredOptionsRef.current = filteredOptions;

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // Memoize input handler to prevent useKeyboard from re-subscribing on every render
  const handleInput = useCallback(
    (event: KeyEvent) => {
      const input = inputFromKey(event);
      // Guard against callbacks firing during initial render
      if (!isMountedRef.current) return;

      // Escape to cancel
      if (event.name === "escape") {
        onCancel();
        return;
      }

      // Enter to confirm selection
      if (isReturnKey(event)) {
        const selected = filteredOptionsRef.current[selectedIndexRef.current];
        if (selected) {
          onSelect(selected.id);
        }
        return;
      }

      // Navigation (vim keys only work when not searching)
      const currentSearchQuery = searchQueryRef.current;
      const goUp =
        event.name === "up" ||
        (!currentSearchQuery && input === "k") ||
        (event.ctrl && input === "p");
      const goDown =
        event.name === "down" ||
        (!currentSearchQuery && input === "j") ||
        (event.ctrl && input === "n");

      const optionsLength = filteredOptionsRef.current.length;

      if (goUp && optionsLength > 0) {
        setSelectedIndex((prev) => (prev === 0 ? optionsLength - 1 : prev - 1));
        return;
      }

      if (goDown && optionsLength > 0) {
        setSelectedIndex((prev) => (prev === optionsLength - 1 ? 0 : prev + 1));
        return;
      }

      // Backspace to delete search character
      if (event.name === "backspace" || event.name === "delete") {
        setSearchQuery((prev) => prev.slice(0, -1));
        return;
      }

      // Type to search (printable characters)
      if (input && !event.ctrl && !event.meta) {
        setSearchQuery((prev) => prev + input);
      }
    },
    [onCancel, onSelect],
  );

  useKeyboard(handleInput);

  return (
    <box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      border={["top"]}
      borderColor="gray"
      paddingTop={1}
    >
      {/* Title */}
      <text fg="brightBlue" attributes={TextAttributes.BOLD}>
        {title}
      </text>

      {/* Description */}
      {description && (
        <box marginTop={0}>
          <text fg="gray">{description}</text>
        </box>
      )}

      {/* Search indicator */}
      {searchQuery && (
        <box marginTop={1} flexDirection="row">
          <text fg="gray">Search: </text>
          <text fg={PRIMARY_COLOR}>{searchQuery}</text>
          <text fg="gray">█</text>
        </box>
      )}

      {/* Options list */}
      <box flexDirection="column" marginTop={1}>
        {filteredOptions.length === 0 ? (
          <text fg="gray">No matching options</text>
        ) : (
          <>
            {/* Scroll up indicator */}
            {startIndex > 0 && (
              <box marginBottom={0} flexDirection="row">
                <text fg="gray"> ↑ {startIndex} more above</text>
              </box>
            )}

            {visibleOptions.map((option, visibleIndex) => {
              const actualIndex = startIndex + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              const isCurrent = option.id === currentId;

              return (
                <box key={option.id} flexDirection="column">
                  <box flexDirection="row">
                    {/* Selection indicator */}
                    <text fg={PRIMARY_COLOR}>{isSelected ? "› " : "  "}</text>

                    {/* Current indicator (checkmark) */}
                    <text fg="green">{isCurrent ? "✓ " : "  "}</text>

                    {/* Option number and name */}
                    <text
                      fg={isSelected ? PRIMARY_COLOR : undefined}
                      attributes={isSelected ? TextAttributes.BOLD : undefined}
                    >
                      {actualIndex + 1}. {option.name}
                    </text>

                    {/* Meta info (e.g., pricing) */}
                    {option.meta && <text fg="gray"> · {option.meta}</text>}
                  </box>

                  {/* Description on separate line */}
                  {option.description && (
                    <box marginLeft={6}>
                      <text fg="gray">{option.description}</text>
                    </box>
                  )}
                </box>
              );
            })}

            {/* Scroll down indicator */}
            {startIndex + maxVisible < filteredOptions.length && (
              <box marginTop={0} flexDirection="row">
                <text fg="gray">
                  {"    "}↓ {filteredOptions.length - startIndex - maxVisible}{" "}
                  more below
                </text>
              </box>
            )}
          </>
        )}
      </box>

      {/* Footer hint */}
      <box marginTop={1}>
        <text fg="gray">
          {searchQuery
            ? "Type to search · Enter to confirm · Esc to cancel"
            : "Type to search · ↑↓ to navigate · Enter to confirm · Esc to cancel"}
        </text>
      </box>
    </box>
  );
}
