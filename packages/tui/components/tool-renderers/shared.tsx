/**
 * Shared components and utilities for tool renderers.
 */

import type { CodeLine, DiffLine } from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React, { type ReactNode, useEffect, useState } from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRenderState } from "../../lib/render-tool";
import { truncateText } from "../../lib/truncate";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function ToolSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <text fg={PRIMARY_COLOR}>{SPINNER_FRAMES[frame]} </text>;
}

/**
 * Get the dot color based on tool state.
 */
export function getDotColor(state: ToolRenderState): string {
  if (state.denied) return "red";
  if (state.interrupted) return PRIMARY_COLOR;
  if (state.approvalRequested) return PRIMARY_COLOR;
  if (state.running) return PRIMARY_COLOR;
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
  const indicator = state.running ? (
    <ToolSpinner />
  ) : state.interrupted ? (
    <text fg={PRIMARY_COLOR}>○ </text>
  ) : (
    <text fg={dotColor}>● </text>
  );
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const headerPrefixLength = 2 + name.length + 1;
  const headerSuffixLength = 1;
  const maxSummaryWidth = Math.max(
    10,
    terminalWidth - headerPrefixLength - headerSuffixLength,
  );
  const displaySummary = truncateText(summary, maxSummaryWidth);
  const errorPrefix = "Error: ";
  const maxErrorWidth = Math.max(10, terminalWidth - 2 - errorPrefix.length);

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <box flexDirection="row">
        {indicator}
        <text
          fg={state.denied ? "red" : "white"}
          attributes={TextAttributes.BOLD}
        >
          {name}
        </text>
        <text fg="gray">(</text>
        <text fg="white">{displaySummary}</text>
        <text fg="gray">)</text>
      </box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </text>
        </box>
      )}

      {output && !state.approvalRequested && !state.interrupted && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          {output}
        </box>
      )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </text>
        </box>
      )}

      {state.error && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            {errorPrefix}
            {truncateText(state.error, maxErrorWidth)}
          </text>
        </box>
      )}

      {state.interrupted && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg={PRIMARY_COLOR}>Interrupted</text>
        </box>
      )}
    </box>
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
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const paddingLeft = 4;
  const lineNumberWidth = 5;
  const indicatorWidth = 2;
  const maxLineWidth = Math.max(
    10,
    terminalWidth - paddingLeft - lineNumberWidth - indicatorWidth,
  );
  const maxSeparatorWidth = Math.max(10, terminalWidth - paddingLeft);
  const headerPrefixLength = 2 + action.length + 1;
  const headerSuffixLength = 1;
  const maxHeaderPathWidth = Math.max(
    10,
    terminalWidth - headerPrefixLength - headerSuffixLength,
  );
  const displayHeaderPath = truncateText(filePath, maxHeaderPathWidth);
  const actionLabel = action === "Create" ? "Created" : "Updated";
  const additionsLabel = `${additions} addition${additions !== 1 ? "s" : ""}`;
  const removalsLabel = `${removals} removal${removals !== 1 ? "s" : ""}`;
  const subPrefixLength = "└ ".length + actionLabel.length + 1;
  const subSuffixLength = ` with ${additionsLabel} and ${removalsLabel}`.length;
  const maxSubPathWidth = Math.max(
    10,
    terminalWidth - subPrefixLength - subSuffixLength,
  );
  const displaySubPath = truncateText(filePath, maxSubPathWidth);
  const errorPrefix = "Error: ";
  const maxErrorWidth = Math.max(10, terminalWidth - 2 - errorPrefix.length);
  const showDiff =
    state.approvalRequested ||
    (!state.running && !state.error && !state.denied && !state.interrupted);
  const indicator = state.running ? (
    <ToolSpinner />
  ) : state.interrupted ? (
    <text fg={PRIMARY_COLOR}>○ </text>
  ) : (
    <text fg={dotColor}>● </text>
  );

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header: ● Update(src/tui/lib/markdown.ts) */}
      <box flexDirection="row">
        {indicator}
        <text fg="white" attributes={TextAttributes.BOLD}>
          {action}
        </text>
        <text fg="gray">(</text>
        <text fg="white">{displayHeaderPath}</text>
        <text fg="gray">)</text>
      </box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </text>
        </box>
      )}

      {/* Subheader: └ Updated src/file.ts with X additions and Y removals */}
      {showDiff && !state.approvalRequested && !state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text>{actionLabel} </text>
          <text attributes={TextAttributes.BOLD}>{displaySubPath}</text>
          <text> with </text>
          <text fg="green">{additionsLabel}</text>
          <text> and </text>
          <text fg="red">{removalsLabel}</text>
        </box>
      )}

      {/* Diff lines */}
      {showDiff &&
        !state.approvalRequested &&
        !state.denied &&
        lines.length > 0 && (
          <box flexDirection="column" paddingLeft={4}>
            {lines.map((line, i) => (
              <box key={i} flexDirection="row">
                {line.type === "separator" ? (
                  <text fg="gray">
                    {line.content.slice(0, maxSeparatorWidth)}
                  </text>
                ) : (
                  <>
                    {/* Line number */}
                    <text fg="gray">
                      {line.lineNumber !== undefined
                        ? String(line.lineNumber).padStart(4, " ")
                        : "    "}{" "}
                    </text>

                    {/* +/- indicator and content */}
                    {line.type === "addition" ? (
                      <>
                        <text bg="#234823">+ </text>
                        <text bg="#234823">
                          {line.content.slice(0, maxLineWidth)}
                        </text>
                      </>
                    ) : line.type === "removal" ? (
                      <>
                        <text bg="#5c2626">- </text>
                        <text bg="#5c2626">
                          {line.content.slice(0, maxLineWidth)}
                        </text>
                      </>
                    ) : (
                      <>
                        <text fg="gray"> </text>
                        <text>{line.content.slice(0, maxLineWidth)}</text>
                      </>
                    )}
                  </>
                )}
              </box>
            ))}
          </box>
        )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </text>
        </box>
      )}

      {state.error && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            {errorPrefix}
            {truncateText(state.error, maxErrorWidth)}
          </text>
        </box>
      )}

      {state.interrupted && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg={PRIMARY_COLOR}>Interrupted</text>
        </box>
      )}
    </box>
  );
}

/**
 * Layout for new file creation with syntax-highlighted code preview.
 */
export function NewFileLayout({
  filePath,
  lines,
  totalLines,
  hiddenLines,
  state,
}: {
  filePath: string;
  lines: CodeLine[];
  totalLines: number;
  hiddenLines: number;
  state: ToolRenderState;
}) {
  const dotColor = getDotColor(state);
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const headerPrefixLength = 2 + "Create".length + 1;
  const headerSuffixLength = 1;
  const maxHeaderPathWidth = Math.max(
    10,
    terminalWidth - headerPrefixLength - headerSuffixLength,
  );
  const displayHeaderPath = truncateText(filePath, maxHeaderPathWidth);
  const lineSuffix = ` (${totalLines} line${totalLines !== 1 ? "s" : ""})`;
  const subPrefixLength = "└ ".length + "Created ".length;
  const maxSubPathWidth = Math.max(
    10,
    terminalWidth - subPrefixLength - lineSuffix.length,
  );
  const displaySubPath = truncateText(filePath, maxSubPathWidth);
  const errorPrefix = "Error: ";
  const maxErrorWidth = Math.max(10, terminalWidth - 2 - errorPrefix.length);
  const showCode =
    state.approvalRequested ||
    (!state.running && !state.error && !state.denied && !state.interrupted);
  const indicator = state.running ? (
    <ToolSpinner />
  ) : state.interrupted ? (
    <text fg={PRIMARY_COLOR}>○ </text>
  ) : (
    <text fg={dotColor}>● </text>
  );

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header: ● Create(src/file.ts) */}
      <box flexDirection="row">
        {indicator}
        <text fg="white" attributes={TextAttributes.BOLD}>
          Create
        </text>
        <text fg="gray">(</text>
        <text fg="white">{displayHeaderPath}</text>
        <text fg="gray">)</text>
      </box>

      {/* Show Running/Waiting status for approval-requested tools */}
      {state.approvalRequested && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="gray">
            {state.isActiveApproval ? "Running…" : "Waiting…"}
          </text>
        </box>
      )}

      {/* Subheader: └ Created src/file.ts (N lines) */}
      {showCode && !state.approvalRequested && !state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text>Created </text>
          <text attributes={TextAttributes.BOLD}>{displaySubPath}</text>
          <text fg="gray">{lineSuffix}</text>
        </box>
      )}

      {/* Code preview with syntax highlighting */}
      {showCode &&
        !state.approvalRequested &&
        !state.denied &&
        lines.length > 0 && (
          <box
            flexDirection="column"
            marginLeft={2}
            borderStyle="rounded"
            borderColor="gray"
            paddingLeft={1}
            paddingRight={1}
          >
            {lines.map((line, i) => (
              <text key={i}>{line.highlighted}</text>
            ))}
            {hiddenLines > 0 && (
              <text fg="gray">
                ... {hiddenLines} more line{hiddenLines !== 1 ? "s" : ""}
              </text>
            )}
          </box>
        )}

      {state.denied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            Denied{state.denialReason ? `: ${state.denialReason}` : ""}
          </text>
        </box>
      )}

      {state.error && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            {errorPrefix}
            {truncateText(state.error, maxErrorWidth)}
          </text>
        </box>
      )}

      {state.interrupted && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg={PRIMARY_COLOR}>Interrupted</text>
        </box>
      )}
    </box>
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
