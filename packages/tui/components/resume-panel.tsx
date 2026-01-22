import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Box, Text, useInput } from "ink";
import type { SessionListItem } from "../lib/session-types";
import { formatTimeAgo } from "../lib/session-storage";

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
        key.upArrow ||
        (!currentSearchQuery && input === "k") ||
        (key.ctrl && input === "p");
      const goDown =
        key.downArrow ||
        (!currentSearchQuery && input === "j") ||
        (key.ctrl && input === "n");

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
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
        return;
      }

      // Type to search (all printable characters)
      // Note: "b" for branch toggle returns early above when search is empty,
      // so it will reach here and be added to search when search has content
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
        Resume session
      </Text>

      {/* Description */}
      <Box marginTop={0}>
        <Text color="gray">
          Select a previous session to continue
          {currentBranch && (
            <>
              {" "}
              (branch:{" "}
              <Text color={filterByBranch ? "yellow" : "gray"}>
                {currentBranch}
              </Text>
              )
            </>
          )}
        </Text>
      </Box>

      {/* Search indicator */}
      {searchQuery && (
        <Box marginTop={1}>
          <Text color="gray">Search: </Text>
          <Text color="yellow">{searchQuery}</Text>
          <Text color="gray">|</Text>
        </Box>
      )}

      {/* Sessions list */}
      <Box flexDirection="column" marginTop={1}>
        {filteredSessions.length === 0 ? (
          <Text color="gray">
            {sessions.length === 0
              ? "No previous sessions found"
              : "No matching sessions"}
          </Text>
        ) : (
          <>
            {/* Scroll up indicator */}
            {startIndex > 0 && (
              <Box marginBottom={0}>
                <Text color="gray"> {startIndex} more above</Text>
              </Box>
            )}

            {visibleSessions.map((session, visibleIndex) => {
              const actualIndex = startIndex + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              const isSameBranch = session.branch === currentBranch;

              return (
                <Box key={session.id} flexDirection="column">
                  <Box>
                    {/* Selection indicator */}
                    <Text color="yellow">{isSelected ? "> " : "  "}</Text>

                    {/* Preview text */}
                    <Box flexGrow={1} flexShrink={1}>
                      <Text
                        color={isSelected ? "yellow" : undefined}
                        bold={isSelected}
                        wrap="truncate"
                      >
                        {session.preview}
                      </Text>
                    </Box>

                    {/* Time ago */}
                    <Text color="gray">
                      {" "}
                      {formatTimeAgo(session.lastActivity)}
                    </Text>

                    {/* Message count */}
                    <Text color="gray"> ({session.messageCount})</Text>

                    {/* Branch indicator */}
                    {!isSameBranch && session.branch && (
                      <Text color="magenta"> [{session.branch}]</Text>
                    )}
                  </Box>
                </Box>
              );
            })}

            {/* Scroll down indicator */}
            {startIndex + maxVisible < filteredSessions.length && (
              <Box marginTop={0}>
                <Text color="gray">
                  {"  "}
                  {filteredSessions.length - startIndex - maxVisible} more below
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
            ? "Type to search "
            : `Type to search${currentBranch ? ` B to ${filterByBranch ? "show all" : "filter branch"} ` : " "}`}
          Enter to select Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
