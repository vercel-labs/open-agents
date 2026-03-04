import { formatTokens } from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React, { useRef } from "react";
import { useChatContext } from "../../chat-context";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { truncateText } from "../../lib/truncate";
import { ToolSpinner, toRelativePath } from "./shared";

type PendingToolCall = { name: string; input: unknown };

function getToolSummary(toolCall: PendingToolCall, cwd: string): string {
  const input = toolCall.input as Record<string, unknown> | undefined;
  switch (toolCall.name) {
    case "read":
    case "write":
    case "edit":
      return input?.filePath
        ? toRelativePath(String(input.filePath), cwd)
        : "";
    case "grep":
    case "glob":
      return input?.pattern ? `"${input.pattern}"` : "";
    case "bash":
      return input?.command ? String(input.command) : "";
    default:
      return "";
  }
}

function SubagentToolCall({
  toolCall,
  isRunning,
}: {
  toolCall: PendingToolCall;
  isRunning: boolean;
}) {
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const { width } = useTerminalDimensions();
  const summary = getToolSummary(toolCall, cwd);
  const terminalWidth = width ?? 80;

  const dotColor = isRunning ? PRIMARY_COLOR : "green";
  const displayName =
    toolCall.name.charAt(0).toUpperCase() + toolCall.name.slice(1);
  const prefixLength = 2 + 2 + displayName.length + 1;
  const suffixLength = 1;
  const maxSummaryWidth = Math.max(
    10,
    terminalWidth - prefixLength - suffixLength,
  );
  const displaySummary = summary ? truncateText(summary, maxSummaryWidth) : "";

  return (
    <box paddingLeft={1} flexDirection="row">
      <text fg="gray">│ </text>
      <box flexDirection="row">
        {isRunning ? <ToolSpinner /> : <text fg={dotColor}>● </text>}
        <text
          fg={isRunning ? PRIMARY_COLOR : "white"}
          attributes={TextAttributes.BOLD}
        >
          {displayName}
        </text>
        {displaySummary && (
          <>
            <text fg="gray">(</text>
            <text fg="white">{displaySummary}</text>
            <text fg="gray">)</text>
          </>
        )}
      </box>
    </box>
  );
}

export function TaskRenderer({ part, state }: ToolRendererProps<"tool-task">) {
  const toolCallsRef = useRef<PendingToolCall[]>([]);
  const lastPendingKeyRef = useRef<string | null>(null);

  const isInputReady = part.state !== "input-streaming";
  const desc = isInputReady ? (part.input?.task ?? "Spawning subagent") : "...";
  const subagentType = isInputReady ? part.input?.subagentType : undefined;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";
  const taskDenialReason = taskDenied ? part.approval?.reason : undefined;

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const isComplete = hasOutput && !isPreliminary;
  const output = hasOutput ? part.output : undefined;

  // Accumulate pending tool calls across yields (each yield replaces the previous)
  if (output?.pending) {
    const key = JSON.stringify(output.pending);
    if (key !== lastPendingKeyRef.current) {
      lastPendingKeyRef.current = key;
      toolCallsRef.current = [...toolCallsRef.current, output.pending];
    }
  }

  const toolCalls = toolCallsRef.current;

  // Show only the last few parts to avoid too much output
  const maxVisible = 4;
  const hiddenCount = Math.max(0, toolCalls.length - maxVisible);
  const visibleCalls = toolCalls.slice(-maxVisible);

  const isStreaming = hasOutput && isPreliminary;

  const dotColor = taskDenied
    ? "red"
    : taskApprovalRequested
      ? PRIMARY_COLOR
      : isStreaming
        ? PRIMARY_COLOR
        : isComplete
          ? "green"
          : PRIMARY_COLOR;
  const indicator = state.interrupted ? (
    <text fg={PRIMARY_COLOR}>○ </text>
  ) : state.running || isStreaming ? (
    <ToolSpinner />
  ) : (
    <text fg={dotColor}>● </text>
  );

  // Format subagent type for display
  const subagentLabel =
    subagentType === "explorer"
      ? "Explorer"
      : subagentType === "executor"
        ? "Executor"
        : "Task";
  const { width: taskWidth } = useTerminalDimensions();
  const taskTerminalWidth = taskWidth ?? 80;
  const taskPrefixLength = 2 + subagentLabel.length + 1;
  const taskSuffixLength = 1;
  const maxDescWidth = Math.max(
    10,
    taskTerminalWidth - taskPrefixLength - taskSuffixLength,
  );
  const displayDesc = truncateText(desc, maxDescWidth);
  const errorPrefix = "Error: ";
  const maxErrorWidth = Math.max(
    10,
    taskTerminalWidth - 2 - errorPrefix.length,
  );

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header */}
      <box flexDirection="row">
        {indicator}
        <text
          fg={taskDenied ? "red" : "white"}
          attributes={TextAttributes.BOLD}
        >
          {subagentLabel}
        </text>
        <text fg="gray">(</text>
        <text fg="white">{displayDesc}</text>
        <text fg="gray">)</text>
      </box>

      {/* Executor approval warning */}
      {taskApprovalRequested && subagentType === "executor" && (
        <box paddingLeft={2} marginTop={1} flexDirection="row">
          <text fg={PRIMARY_COLOR}>
            This executor has full write access and can create, modify, and
            delete files.
          </text>
        </box>
      )}

      {/* Denied message */}
      {taskDenied && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">
            Denied{taskDenialReason ? `: ${taskDenialReason}` : ""}
          </text>
        </box>
      )}

      {/* Nested tool calls from subagent */}
      {hasOutput && visibleCalls.length > 0 && !state.interrupted && (
        <box flexDirection="column" paddingLeft={2} marginTop={1}>
          {hiddenCount > 0 && (
            <box marginBottom={1} flexDirection="row">
              <text fg="gray">... {hiddenCount} more above</text>
            </box>
          )}
          {visibleCalls.map((tc, i) => {
            const isLast = i === visibleCalls.length - 1;
            const isToolRunning = isLast && isPreliminary;
            return (
              <SubagentToolCall
                key={`${tc.name}-${i + hiddenCount}`}
                toolCall={tc}
                isRunning={isToolRunning}
              />
            );
          })}
        </box>
      )}

      {/* Completion status */}
      {isComplete && !state.interrupted && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="white">
            Complete ({toolCalls.length} tool calls
            {output?.usage?.inputTokens
              ? `, ${formatTokens(output.usage.inputTokens)} tokens`
              : ""}
            )
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

// Export SubagentToolCall for use in other places if needed
export { SubagentToolCall };
