import type { SubagentUIMessage } from "@open-harness/agent";
import { formatTokens } from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import React from "react";
import { PRIMARY_COLOR } from "../../lib/colors";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolSpinner } from "./shared";

type SubagentMessagePart = SubagentUIMessage["parts"][number];

function getToolSummary(part: SubagentMessagePart): string {
  switch (part.type) {
    case "tool-read":
    case "tool-write":
    case "tool-edit":
      return part.input?.filePath ?? "";
    case "tool-grep":
    case "tool-glob":
      return part.input?.pattern ? `"${part.input.pattern}"` : "";
    case "tool-bash":
      return part.input?.command ?? "";
    default:
      return "";
  }
}

function SubagentToolCall({ part }: { part: SubagentMessagePart }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);
  const isRunning =
    part.state === "input-streaming" || part.state === "input-available";
  const hasError = part.state === "output-error";
  const summary = getToolSummary(part);

  const dotColor = isRunning ? PRIMARY_COLOR : hasError ? "red" : "green";
  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);

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
        {summary && (
          <>
            <text fg="gray">(</text>
            <text fg="white">{summary}</text>
            <text fg="gray">)</text>
          </>
        )}
        {hasError && <text fg="red"> - error</text>}
      </box>
    </box>
  );
}

export function TaskRenderer({ part, state }: ToolRendererProps<"tool-task">) {
  const desc = part.input?.task ?? "Spawning subagent";
  const subagentType = part.input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";
  const taskDenialReason = taskDenied ? part.approval?.reason : undefined;

  // The output is a UIMessage with parts (text, tool-invocation, etc.)
  // Preliminary results have preliminary: true, final result has preliminary: false/undefined
  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const message = hasOutput ? part.output : undefined;

  // Get all parts in order, filter to text and tool parts
  const messageParts = message?.parts ?? [];
  const relevantParts = messageParts.filter(
    (p) => isToolUIPart(p) || isTextUIPart(p),
  );
  const toolParts = messageParts.filter(isToolUIPart);

  // Show only the last few parts to avoid too much output
  const maxVisible = 4;
  const hiddenCount = Math.max(0, relevantParts.length - maxVisible);
  const visibleParts = relevantParts.slice(-maxVisible);

  const isComplete = hasOutput && !isPreliminary;
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

  // Format subagent type for display
  const subagentLabel =
    subagentType === "explorer"
      ? "Explorer"
      : subagentType === "executor"
        ? "Executor"
        : "Task";

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header */}
      <box flexDirection="row">
        {state.running || isStreaming ? (
          <ToolSpinner />
        ) : (
          <text fg={dotColor}>● </text>
        )}
        <text
          fg={taskDenied ? "red" : "white"}
          attributes={TextAttributes.BOLD}
        >
          {subagentLabel}
        </text>
        <text fg="gray">(</text>
        <text fg="white">{desc}</text>
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

      {/* Nested parts from subagent (text and tools in order) */}
      {hasOutput && visibleParts.length > 0 && (
        <box flexDirection="column" paddingLeft={2} marginTop={1}>
          {hiddenCount > 0 && (
            <box marginBottom={1} flexDirection="row">
              <text fg="gray">... {hiddenCount} more above</text>
            </box>
          )}
          {visibleParts.map((p, i) => {
            if (isToolUIPart(p)) {
              return <SubagentToolCall key={p.toolCallId} part={p} />;
            }
            if (isTextUIPart(p)) {
              // Show truncated text, dimmed
              const text = p.text.trim();
              if (!text) return null;
              const truncated =
                text.length > 80 ? text.slice(0, 80) + "..." : text;
              return (
                <box key={`text-${i}`} paddingLeft={1} flexDirection="row">
                  <text fg="gray">│ </text>
                  <text fg="gray" attributes={TextAttributes.DIM}>
                    {truncated}
                  </text>
                </box>
              );
            }
            return null;
          })}
        </box>
      )}

      {/* Completion status */}
      {isComplete && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="white">
            Complete ({toolParts.length} tool calls
            {message?.metadata?.totalMessageUsage?.inputTokens
              ? `, ${formatTokens(message.metadata.totalMessageUsage.inputTokens)} tokens`
              : ""}
            )
          </text>
        </box>
      )}

      {state.error && (
        <box paddingLeft={2} flexDirection="row">
          <text fg="gray">└ </text>
          <text fg="red">Error: {state.error.slice(0, 80)}</text>
        </box>
      )}
    </box>
  );
}

// Export SubagentToolCall for use in other places if needed
export { SubagentToolCall };
