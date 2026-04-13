"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { getFileIcon, FolderIcon } from "@/components/file-type-icons";
import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";

interface FileSuggestionsDropdownProps {
  suggestions: FileSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: FileSuggestion) => void;
  isLoading?: boolean;
}

const MAX_VISIBLE_ITEMS = 10;

export function FileSuggestionsDropdown({
  suggestions,
  selectedIndex,
  onSelect,
  isLoading,
}: FileSuggestionsDropdownProps) {
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
        Loading files...
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
        style={{ maxHeight: `${MAX_VISIBLE_ITEMS * 32}px` }}
      >
        <div className="space-y-px">
          {suggestions.map((suggestion, index) => {
            const fullPath = suggestion.display;
            const normalizedPath = suggestion.isDirectory
              ? fullPath.replace(/\/$/, "")
              : fullPath;
            const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
            const dirPath = normalizedPath.slice(
              0,
              normalizedPath.length - fileName.length,
            );

            return (
              <button
                key={suggestion.value}
                ref={index === selectedIndex ? selectedRef : null}
                type="button"
                onClick={() => onSelect(suggestion)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent",
                )}
              >
                {suggestion.isDirectory ? (
                  <FolderIcon className="h-4 w-4 shrink-0" />
                ) : (
                  getFileIcon(fileName, { className: "h-4 w-4 shrink-0" })
                )}
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                  <span className="shrink-0 text-xs font-medium text-foreground font-mono">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span
                      className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground"
                      dir="rtl"
                    >
                      <bdi>{dirPath.replace(/\/$/, "")}</bdi>
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="border-t bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <kbd className="rounded bg-muted px-1">Tab</kbd> or{" "}
        <kbd className="rounded bg-muted px-1">Enter</kbd> to select,{" "}
        <kbd className="rounded bg-muted px-1">Esc</kbd> to dismiss
      </div>
    </div>
  );
}
