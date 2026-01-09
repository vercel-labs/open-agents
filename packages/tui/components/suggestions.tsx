import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";

export type Suggestion = {
  value: string;
  display: string;
  isDirectory?: boolean;
};

type SuggestionsProps = {
  suggestions: Suggestion[];
  selectedIndex: number;
  visible: boolean;
};

function calculateWindow(
  selectedIndex: number,
  totalItems: number,
  maxDisplay: number,
): { windowStart: number; windowEnd: number } {
  if (totalItems <= maxDisplay) {
    return { windowStart: 0, windowEnd: totalItems };
  }

  // Keep selection roughly centered in window
  let windowStart = Math.max(0, selectedIndex - Math.floor(maxDisplay / 2));

  // Don't let window extend past end
  if (windowStart + maxDisplay > totalItems) {
    windowStart = totalItems - maxDisplay;
  }

  windowStart = Math.max(0, windowStart);

  return {
    windowStart,
    windowEnd: Math.min(windowStart + maxDisplay, totalItems),
  };
}

export const Suggestions = memo(function Suggestions({
  suggestions,
  selectedIndex,
  visible,
}: SuggestionsProps) {
  const maxDisplay = 10;

  // Calculate window based on selected index (must be called before early return)
  const { windowStart, windowEnd } = useMemo(
    () => calculateWindow(selectedIndex, suggestions.length, maxDisplay),
    [selectedIndex, suggestions.length],
  );

  if (!visible || suggestions.length === 0) {
    return null;
  }

  const displayedSuggestions = suggestions.slice(windowStart, windowEnd);
  const hasItemsAbove = windowStart > 0;
  const hasItemsBelow = windowEnd < suggestions.length;
  const itemsAbove = windowStart;
  const itemsBelow = suggestions.length - windowEnd;

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1} marginTop={0}>
      {/* Scroll indicator: items above */}
      {hasItemsAbove && (
        <Text color="gray" dimColor>
          ... {itemsAbove} above
        </Text>
      )}

      {displayedSuggestions.map((suggestion, displayIndex) => {
        // Map display index back to actual suggestion index
        const actualIndex = windowStart + displayIndex;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={suggestion.value}>
            {/* Selection indicator */}
            <Text color={isSelected ? "yellow" : "gray"}>
              {isSelected ? "> " : "  "}
            </Text>
            {/* Suggestion text */}
            <Text
              color={
                isSelected
                  ? "yellow"
                  : suggestion.isDirectory
                    ? "cyan"
                    : "white"
              }
              bold={isSelected}
            >
              {suggestion.display}
            </Text>
          </Box>
        );
      })}

      {/* Scroll indicator: items below */}
      {hasItemsBelow && (
        <Text color="gray" dimColor>
          ... {itemsBelow} below
        </Text>
      )}
    </Box>
  );
});
