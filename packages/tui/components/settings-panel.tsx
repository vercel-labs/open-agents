import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Box, Text, useInput } from "ink";

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

  // Memoize input handler to prevent useInput from re-subscribing on every render
  const handleInput = useCallback(
    (
      input: string,
      key: {
        escape?: boolean;
        return?: boolean;
        upArrow?: boolean;
        downArrow?: boolean;
        ctrl?: boolean;
        backspace?: boolean;
        delete?: boolean;
        meta?: boolean;
      },
    ) => {
      // Guard against callbacks firing during initial render
      if (!isMountedRef.current) return;

      // Escape to cancel
      if (key.escape) {
        onCancel();
        return;
      }

      // Enter to confirm selection
      if (key.return) {
        const selected = filteredOptionsRef.current[selectedIndexRef.current];
        if (selected) {
          onSelect(selected.id);
        }
        return;
      }

      // Navigation (vim keys only work when not searching)
      const currentSearchQuery = searchQueryRef.current;
      const goUp =
        key.upArrow ||
        (!currentSearchQuery && input === "k") ||
        (key.ctrl && input === "p");
      const goDown =
        key.downArrow ||
        (!currentSearchQuery && input === "j") ||
        (key.ctrl && input === "n");

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
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
        return;
      }

      // Type to search (printable characters)
      if (input && !key.ctrl && !key.meta) {
        setSearchQuery((prev) => prev + input);
      }
    },
    [onCancel, onSelect],
  );

  useInput(handleInput);

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
      paddingTop={1}
    >
      {/* Title */}
      <Text color="blueBright" bold>
        {title}
      </Text>

      {/* Description */}
      {description && (
        <Box marginTop={0}>
          <Text color="gray">{description}</Text>
        </Box>
      )}

      {/* Search indicator */}
      {searchQuery && (
        <Box marginTop={1}>
          <Text color="gray">Search: </Text>
          <Text color="yellow">{searchQuery}</Text>
          <Text color="gray">█</Text>
        </Box>
      )}

      {/* Options list */}
      <Box flexDirection="column" marginTop={1}>
        {filteredOptions.length === 0 ? (
          <Text color="gray">No matching options</Text>
        ) : (
          <>
            {/* Scroll up indicator */}
            {startIndex > 0 && (
              <Box marginBottom={0}>
                <Text color="gray"> ↑ {startIndex} more above</Text>
              </Box>
            )}

            {visibleOptions.map((option, visibleIndex) => {
              const actualIndex = startIndex + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              const isCurrent = option.id === currentId;

              return (
                <Box key={option.id} flexDirection="column">
                  <Box>
                    {/* Selection indicator */}
                    <Text color="yellow">{isSelected ? "› " : "  "}</Text>

                    {/* Current indicator (checkmark) */}
                    <Text color="green">{isCurrent ? "✓ " : "  "}</Text>

                    {/* Option number and name */}
                    <Text
                      color={isSelected ? "yellow" : undefined}
                      bold={isSelected}
                    >
                      {actualIndex + 1}. {option.name}
                    </Text>

                    {/* Meta info (e.g., pricing) */}
                    {option.meta && <Text color="gray"> · {option.meta}</Text>}
                  </Box>

                  {/* Description on separate line */}
                  {option.description && (
                    <Box marginLeft={6}>
                      <Text color="gray">{option.description}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}

            {/* Scroll down indicator */}
            {startIndex + maxVisible < filteredOptions.length && (
              <Box marginTop={0}>
                <Text color="gray">
                  {"    "}↓ {filteredOptions.length - startIndex - maxVisible}{" "}
                  more below
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color="gray">
          {searchQuery
            ? "Type to search · Enter to confirm · Esc to cancel"
            : "Type to search · ↑↓ to navigate · Enter to confirm · Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
}
