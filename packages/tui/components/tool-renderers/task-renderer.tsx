import React from "react";
import { Box, Text } from "ink";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import { formatTokens } from "@open-harness/shared";
import type { SubagentUIMessage } from "@open-harness/agent";
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

  const dotColor = isRunning ? "yellow" : hasError ? "red" : "green";
  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);

  return (
    <Box paddingLeft={1}>
      <Text color="gray">│ </Text>
      <Box>
        {isRunning ? <ToolSpinner /> : <Text color={dotColor}>● </Text>}
        <Text bold color={isRunning ? "yellow" : "white"}>
          {displayName}
        </Text>
        {summary && (
          <>
            <Text color="gray">(</Text>
            <Text color="white">{summary}</Text>
            <Text color="gray">)</Text>
          </>
        )}
        {hasError && <Text color="red"> - error</Text>}
      </Box>
    </Box>
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
      ? "yellow"
      : isStreaming
        ? "yellow"
        : isComplete
          ? "green"
          : "yellow";

  // Format subagent type for display
  const subagentLabel =
    subagentType === "explorer"
      ? "Explorer"
      : subagentType === "executor"
        ? "Executor"
        : "Task";

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header */}
      <Box>
        {state.running || isStreaming ? (
          <ToolSpinner />
        ) : (
          <Text color={dotColor}>● </Text>
        )}
        <Text bold color={taskDenied ? "red" : "white"}>
          {subagentLabel}
        </Text>
        <Text color="gray">(</Text>
        <Text color="white">{desc}</Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Executor approval warning */}
      {taskApprovalRequested && subagentType === "executor" && (
        <Box paddingLeft={2} marginTop={1}>
          <Text color="yellow">
            This executor has full write access and can create, modify, and
            delete files.
          </Text>
        </Box>
      )}

      {/* Denied message */}
      {taskDenied && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="red">
            Denied{taskDenialReason ? `: ${taskDenialReason}` : ""}
          </Text>
        </Box>
      )}

      {/* Nested parts from subagent (text and tools in order) */}
      {hasOutput && visibleParts.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          {hiddenCount > 0 && (
            <Box marginBottom={1}>
              <Text color="gray">... {hiddenCount} more above</Text>
            </Box>
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
                <Box key={`text-${i}`} paddingLeft={1}>
                  <Text color="gray">│ </Text>
                  <Text color="gray" dimColor>
                    {truncated}
                  </Text>
                </Box>
              );
            }
            return null;
          })}
        </Box>
      )}

      {/* Completion status */}
      {isComplete && (
        <Box paddingLeft={2}>
          <Text color="gray">└ </Text>
          <Text color="white">
            Complete ({toolParts.length} tool calls
            {message?.metadata?.totalMessageUsage?.inputTokens
              ? `, ${formatTokens(message.metadata.totalMessageUsage.inputTokens)} tokens`
              : ""}
            )
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

// Export SubagentToolCall for use in other places if needed
export { SubagentToolCall };
