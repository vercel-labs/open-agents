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
import { formatTimeAgo } from "../lib/session-storage";
import type { SessionListItem } from "../lib/session-types";

type ResumePanelProps = {
  sessions: SessionListItem[];
  currentBranch: string;
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
  maxVisible?: number;
};

export function ResumePanel({
  sessions,
  currentBranch,
  onSelect,
  onCancel,
  maxVisible = 10,
}: ResumePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterByBranch, setFilterByBranch] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Guard to prevent callbacks from firing during initial render
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
  }, []);

  // Filter sessions based on search query and branch filter
  const filteredSessions = useMemo(() => {
    let filtered = sessions;

    // Apply branch filter
    if (filterByBranch && currentBranch) {
      filtered = filtered.filter((s) => s.branch === currentBranch);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((s) =>
        s.preview.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [sessions, searchQuery, filterByBranch, currentBranch]);

  // Reset selection when filters change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, filterByBranch]);

  // Calculate visible window of sessions
  const { visibleSessions, startIndex } = useMemo(() => {
    const total = filteredSessions.length;
    if (total <= maxVisible) {
      return { visibleSessions: filteredSessions, startIndex: 0 };
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
      visibleSessions: filteredSessions.slice(start, start + maxVisible),
      startIndex: start,
    };
  }, [filteredSessions, selectedIndex, maxVisible]);

  // Use refs for input handler
  const filteredSessionsRef = useRef(filteredSessions);
  filteredSessionsRef.current = filteredSessions;

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // Memoize input handler
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
        const selected = filteredSessionsRef.current[selectedIndexRef.current];
        if (selected) {
          onSelect(selected.id);
        }
        return;
      }

      // Branch filter toggle
      if (input.toLowerCase() === "b" && !searchQueryRef.current) {
        setFilterByBranch((prev) => !prev);
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

      const sessionsLength = filteredSessionsRef.current.length;

      if (goUp && sessionsLength > 0) {
        setSelectedIndex((prev) =>
          prev === 0 ? sessionsLength - 1 : prev - 1,
        );
        return;
      }

      if (goDown && sessionsLength > 0) {
        setSelectedIndex((prev) =>
          prev === sessionsLength - 1 ? 0 : prev + 1,
        );
        return;
      }

      // Backspace to delete search character
      if (event.name === "backspace" || event.name === "delete") {
        setSearchQuery((prev) => prev.slice(0, -1));
        return;
      }

      // Type to search (all printable characters)
      // Note: "b" for branch toggle returns early above when search is empty,
      // so it will reach here and be added to search when search has content
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
        Resume session
      </text>

      {/* Description */}
      <box marginTop={0}>
        <text fg="gray">
          Select a previous session to continue
          {currentBranch && (
            <>
              {" "}
              (branch:{" "}
              <span fg={filterByBranch ? PRIMARY_COLOR : "gray"}>
                {currentBranch}
              </span>
              )
            </>
          )}
        </text>
      </box>

      {/* Search indicator */}
      {searchQuery && (
        <box marginTop={1} flexDirection="row">
          <text fg="gray">Search: </text>
          <text fg={PRIMARY_COLOR}>{searchQuery}</text>
          <text fg="gray">|</text>
        </box>
      )}

      {/* Sessions list */}
      <box flexDirection="column" marginTop={1}>
        {filteredSessions.length === 0 ? (
          <text fg="gray">
            {sessions.length === 0
              ? "No previous sessions found"
              : "No matching sessions"}
          </text>
        ) : (
          <>
            {/* Scroll up indicator */}
            {startIndex > 0 && (
              <box marginBottom={0} flexDirection="row">
                <text fg="gray"> {startIndex} more above</text>
              </box>
            )}

            {visibleSessions.map((session, visibleIndex) => {
              const actualIndex = startIndex + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              const isSameBranch = session.branch === currentBranch;

              return (
                <box key={session.id} flexDirection="column">
                  <box flexDirection="row">
                    {/* Selection indicator */}
                    <text fg={PRIMARY_COLOR}>{isSelected ? "> " : "  "}</text>

                    {/* Preview text */}
                    <box flexGrow={1} flexShrink={1}>
                      <text
                        fg={isSelected ? PRIMARY_COLOR : undefined}
                        attributes={
                          isSelected ? TextAttributes.BOLD : undefined
                        }
                        wrapMode="none"
                        truncate
                      >
                        {session.preview}
                      </text>
                    </box>

                    {/* Time ago */}
                    <text fg="gray">
                      {" "}
                      {formatTimeAgo(session.lastActivity)}
                    </text>

                    {/* Message count */}
                    <text fg="gray"> ({session.messageCount})</text>

                    {/* Branch indicator */}
                    {!isSameBranch && session.branch && (
                      <text fg="magenta"> [{session.branch}]</text>
                    )}
                  </box>
                </box>
              );
            })}

            {/* Scroll down indicator */}
            {startIndex + maxVisible < filteredSessions.length && (
              <box marginTop={0} flexDirection="row">
                <text fg="gray">
                  {"  "}
                  {filteredSessions.length - startIndex - maxVisible} more below
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
            ? "Type to search "
            : `Type to search${currentBranch ? ` B to ${filterByBranch ? "show all" : "filter branch"} ` : " "}`}
          Enter to select Esc to cancel
        </text>
      </box>
    </box>
  );
}
