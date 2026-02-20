"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SkillSuggestion } from "@/app/api/sessions/[sessionId]/skills/route";

interface SlashCommandDropdownProps {
  suggestions: SkillSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: SkillSuggestion) => void;
  isLoading?: boolean;
}

const MAX_VISIBLE_ITEMS = 10;

export function SlashCommandDropdown({
  suggestions,
  selectedIndex,
  onSelect,
  isLoading,
}: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      const list = listRef.current;
      const item = selectedRef.current;
      const listRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();

      if (itemRect.top < listRect.top) {
        item.scrollIntoView({ block: "start" });
      } else if (itemRect.bottom > listRect.bottom) {
        item.scrollIntoView({ block: "end" });
      }
    }
  }, [selectedIndex]);

  if (isLoading) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        Loading skills...
      </div>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-md border bg-popover shadow-md">
      <div
        ref={listRef}
        className="max-h-[280px] overflow-y-auto py-1"
        style={{ maxHeight: `${MAX_VISIBLE_ITEMS * 36}px` }}
      >
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.name}
            ref={index === selectedIndex ? selectedRef : null}
            type="button"
            onClick={() => onSelect(suggestion)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted",
            )}
          >
            <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">/{suggestion.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {suggestion.description}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="border-t bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <kbd className="rounded bg-muted px-1">Tab</kbd> or{" "}
        <kbd className="rounded bg-muted px-1">Enter</kbd> to select,{" "}
        <kbd className="rounded bg-muted px-1">Esc</kbd> to dismiss
      </div>
    </div>
  );
}
