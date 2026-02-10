import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React, { memo, useMemo } from "react";
import { PRIMARY_COLOR } from "../lib/colors";

export type Suggestion = {
  value: string;
  display: string;
  isDirectory?: boolean;
  description?: string;
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

function truncateDescription(description: string, maxWidth: number): string {
  if (description.length <= maxWidth) {
    return description;
  }
  if (maxWidth <= 3) {
    return description.slice(0, maxWidth);
  }
  return description.slice(0, maxWidth - 3) + "...";
}

export const Suggestions = memo(function Suggestions({
  suggestions,
  selectedIndex,
  visible,
}: SuggestionsProps) {
  const maxDisplay = 10;
  const { width } = useTerminalDimensions();
  const terminalWidth = width || 80;

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

  // Calculate max width for column alignment
  const maxDisplayWidth = Math.max(
    ...displayedSuggestions.map((s) => s.display.length),
  );
  const columnWidth = maxDisplayWidth + 4; // Add padding between columns

  // Calculate available width for description
  // Account for: paddingLeft (1) + columnWidth + some margin
  const descriptionMaxWidth = terminalWidth - columnWidth - 4;

  return (
    <box flexDirection="column" paddingLeft={1} marginTop={1} marginBottom={1}>
      {/* Scroll indicator: items above */}
      {hasItemsAbove && (
        <text fg="gray" attributes={TextAttributes.DIM}>
          ... {itemsAbove} above
        </text>
      )}

      {displayedSuggestions.map((suggestion, displayIndex) => {
        // Map display index back to actual suggestion index
        const actualIndex = windowStart + displayIndex;
        const isSelected = actualIndex === selectedIndex;
        const truncatedDescription = suggestion.description
          ? truncateDescription(suggestion.description, descriptionMaxWidth)
          : undefined;

        return (
          <box key={suggestion.value} flexDirection="row">
            <text
              fg={
                isSelected
                  ? PRIMARY_COLOR
                  : suggestion.isDirectory
                    ? "white"
                    : "gray"
              }
              attributes={isSelected ? TextAttributes.BOLD : undefined}
            >
              {suggestion.display.padEnd(columnWidth)}
            </text>
            {truncatedDescription && (
              <text fg={isSelected ? PRIMARY_COLOR : "gray"}>
                {truncatedDescription}
              </text>
            )}
          </box>
        );
      })}

      {/* Scroll indicator: items below */}
      {hasItemsBelow && (
        <text fg="gray" attributes={TextAttributes.DIM}>
          ... {itemsBelow} below
        </text>
      )}
    </box>
  );
});
