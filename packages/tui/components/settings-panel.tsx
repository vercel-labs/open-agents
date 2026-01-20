import React, { useState, useMemo, useEffect } from "react";
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
};

export function SettingsPanel({
  title,
  description,
  options,
  currentId,
  onSelect,
  onCancel,
}: SettingsPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(query) ||
        opt.description?.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  // Reset selection when filtered options change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredOptions.length]);

  // Set initial selection to current value
  useEffect(() => {
    const currentIndex = filteredOptions.findIndex(
      (opt) => opt.id === currentId,
    );
    if (currentIndex !== -1) {
      setSelectedIndex(currentIndex);
    }
  }, [currentId, filteredOptions]);

  useInput((input, key) => {
    // Escape to cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Enter to confirm selection
    if (key.return) {
      const selected = filteredOptions[selectedIndex];
      if (selected) {
        onSelect(selected.id);
      }
      return;
    }

    // Navigation
    const goUp =
      key.upArrow ||
      input === "k" ||
      (key.ctrl && input === "p") ||
      (key.shift && key.tab);
    const goDown =
      key.downArrow ||
      input === "j" ||
      (key.ctrl && input === "n") ||
      (!key.shift && key.tab);

    if (goUp && filteredOptions.length > 0) {
      setSelectedIndex((prev) =>
        prev === 0 ? filteredOptions.length - 1 : prev - 1,
      );
      return;
    }

    if (goDown && filteredOptions.length > 0) {
      setSelectedIndex((prev) =>
        prev === filteredOptions.length - 1 ? 0 : prev + 1,
      );
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
  });

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
          filteredOptions.map((option, index) => {
            const isSelected = index === selectedIndex;
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
                    {index + 1}. {option.name}
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
          })
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
