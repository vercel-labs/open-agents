/**
 * Shared components and utilities for tool renderers.
 */
import React, { useState, useEffect, type ReactNode } from "react";
import { Box, Text } from "ink";
import type { DiffLine } from "../../lib/diff.js";
import type { ToolRenderState } from "../../lib/render-tool.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function ToolSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color="yellow">{SPINNER_FRAMES[frame]} </Text>;
}

/**
 * Get the dot color based on tool state.
 */
export function getDotColor(state: ToolRenderState): string {
  if (state.denied) return "red";
  if (state.approvalRequested) return "yellow";
  if (state.running) return "yellow";
  if (state.error) return "red";
  return "green";
}

/**
 * Standard layout for simple tools (read, glob, grep, etc.)
 */
export function ToolLayout({
  name,
  summary,
  output,
  state,
}: {
  name: string;
  summary: string;
  output?: ReactNode;
  state: ToolRenderState;
}) {
  const dotColor = getDotColor(state);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        {state.running ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color={state.denied ? "red" : "white"}>
          {name}
        </Text>
        <Text color="gray">(</Text>
        <Text color="white">{summary}</Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </Text>
        </Box>
      )}

      {output && !state.approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          {output}
        </Box>
      )}

      {state.denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </Text>
        </Box>
      )}

      {state.error && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">Error: {state.error.slice(0, 80)}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Layout for file change tools (write, edit) with diff display.
 */
export function FileChangeLayout({
  action,
  filePath,
  additions,
  removals,
  lines,
  state,
}: {
  action: "Create" | "Update";
  filePath: string;
  additions: number;
  removals: number;
  lines: DiffLine[];
  state: ToolRenderState;
}) {
  const dotColor = getDotColor(state);
  const maxWidth = 80;
  const showDiff =
    state.approvalRequested ||
    (!state.running && !state.error && !state.denied);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header: ● Update(src/tui/lib/markdown.ts) */}
      <Box>
        {state.running ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color="white">
          {action}
        </Text>
        <Text color="gray">(</Text>
        <Text color="white">{filePath}</Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </Text>
        </Box>
      )}

      {/* Subheader: └ Updated src/file.ts with X additions and Y removals */}
      {showDiff && !state.approvalRequested && !state.denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text>{action === "Create" ? "Created" : "Updated"} </Text>
          <Text bold>{filePath}</Text>
          <Text> with </Text>
          <Text color="green">
            {additions} addition{additions !== 1 ? "s" : ""}
          </Text>
          <Text> and </Text>
          <Text color="red">
            {removals} removal{removals !== 1 ? "s" : ""}
          </Text>
        </Box>
      )}

      {/* Diff lines */}
      {showDiff &&
        !state.approvalRequested &&
        !state.denied &&
        lines.length > 0 && (
          <Box flexDirection="column" paddingLeft={4}>
            {lines.map((line, i) => (
              <Box key={i}>
                {line.type === "separator" ? (
                  <Text color="gray">{line.content}</Text>
                ) : (
                  <>
                    {/* Line number */}
                    <Text color="gray">
                      {line.lineNumber !== undefined
                        ? String(line.lineNumber).padStart(4, " ")
                        : "    "}{" "}
                    </Text>

                    {/* +/- indicator and content */}
                    {line.type === "addition" ? (
                      <>
                        <Text backgroundColor="#234823">+ </Text>
                        <Text backgroundColor="#234823">
                          {line.content.slice(0, maxWidth)}
                        </Text>
                      </>
                    ) : line.type === "removal" ? (
                      <>
                        <Text backgroundColor="#5c2626">- </Text>
                        <Text backgroundColor="#5c2626">
                          {line.content.slice(0, maxWidth)}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text color="gray"> </Text>
                        <Text>{line.content.slice(0, maxWidth)}</Text>
                      </>
                    )}
                  </>
                )}
              </Box>
            ))}
          </Box>
        )}

      {state.denied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </Text>
        </Box>
      )}

      {state.error && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">Error: {state.error.slice(0, 80)}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Helper to convert absolute file path to relative path for display.
 */
export function toRelativePath(filePath: string, cwd: string): string {
  // Ensure cwd ends with separator for proper prefix matching
  const cwdPrefix = cwd.endsWith("/") ? cwd : cwd + "/";

  if (filePath.startsWith(cwdPrefix)) {
    return filePath.slice(cwdPrefix.length);
  }
  if (filePath === cwd) {
    return ".";
  }
  // Already relative or outside cwd
  return filePath;
}
