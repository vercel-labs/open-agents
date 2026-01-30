import type { SubagentUIMessage, TaskToolUIPart } from "@open-harness/agent";
import { formatTokens } from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { getToolName, isToolUIPart } from "ai";
import React, { useEffect, useRef, useState } from "react";
import { useChatContext } from "../chat-context";
import { PRIMARY_COLOR } from "../lib/colors";
import { truncateText } from "../lib/truncate";
import { toRelativePath } from "./tool-renderers/shared";

type SubagentMessagePart = SubagentUIMessage["parts"][number];

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function TaskSpinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <text fg="gray">{SPINNER_FRAMES[frame]}</text>;
}

function FlashingDot() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return <text fg="gray">{visible ? "●" : " "}</text>;
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function useTaskTiming(isRunning: boolean) {
  const startTimeRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (isRunning && !startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    if (!isRunning) {
      return;
    }

    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(
          Math.floor((Date.now() - startTimeRef.current) / 1000),
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  return elapsedSeconds;
}

type TaskStatus =
  | "pending"
  | "running"
  | "complete"
  | "error"
  | "approval-requested"
  | "denied"
  | "interrupted";

function getTaskStatus(part: TaskToolUIPart, isStreaming: boolean): TaskStatus {
  if (part.state === "approval-requested") return "approval-requested";
  if (part.state === "output-denied") return "denied";
  if (part.state === "output-error") return "error";
  if (part.state === "output-available" && !part.preliminary) return "complete";
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.preliminary)
  ) {
    // If streaming stopped but task is still in a running state, it was interrupted
    return isStreaming ? "running" : "interrupted";
  }
  return "pending";
}

function countTaskTools(part: TaskToolUIPart): number {
  if (part.state !== "output-available") return 0;
  const message = part.output;
  if (!message?.parts) return 0;
  return message.parts.filter(isToolUIPart).length;
}

function getTaskTokens(part: TaskToolUIPart): number | null {
  if (part.state !== "output-available") return null;
  const message = part.output;
  return message?.metadata?.lastStepUsage?.inputTokens ?? null;
}

function getToolSummary(part: SubagentMessagePart, cwd: string): string {
  switch (part.type) {
    case "tool-read":
    case "tool-write":
    case "tool-edit":
      return part.input?.filePath
        ? toRelativePath(part.input.filePath, cwd)
        : "";
    case "tool-grep":
    case "tool-glob":
      return part.input?.pattern ? `"${part.input.pattern}"` : "";
    case "tool-bash": {
      return part.input?.command ?? "";
    }
    default:
      return "";
  }
}

function getLastToolInfo(
  part: TaskToolUIPart,
  cwd: string,
): { name: string; summary: string } | null {
  if (part.state !== "output-available") return null;
  const message = part.output;
  if (!message?.parts) return null;

  const toolParts = message.parts.filter(
    (toolPart) =>
      isToolUIPart(toolPart) && toolPart.state !== "input-streaming",
  );
  if (toolParts.length === 0) return null;

  const lastTool = toolParts[toolParts.length - 1];
  // Double-check needed for TypeScript narrowing with union types
  if (!lastTool || !isToolUIPart(lastTool)) return null;

  const toolName = getToolName(lastTool);
  const summary = getToolSummary(lastTool, cwd);

  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return { name: displayName, summary };
}

function TaskStatusIndicator({ status }: { status: TaskStatus }) {
  switch (status) {
    case "running":
      return <TaskSpinner />;
    case "pending":
      return <FlashingDot />;
    case "approval-requested":
      // Static white circle for approval needed
      return <text fg="white">●</text>;
    case "complete":
      return <text fg="green">✓</text>;
    case "interrupted":
      return <text fg={PRIMARY_COLOR}>○</text>;
    case "error":
    case "denied":
      return <text fg="red">✗</text>;
    default:
      return <text fg="gray">●</text>;
  }
}

function TaskItem({
  part,
  isLast,
  isStreaming,
}: {
  part: TaskToolUIPart;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const status = getTaskStatus(part, isStreaming);
  const isRunning = status === "running" || status === "pending";
  const elapsedSeconds = useTaskTiming(isRunning);
  const toolCount = countTaskTools(part);
  const tokenCount = getTaskTokens(part);
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const lastTool = getLastToolInfo(part, cwd);
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;

  const desc = part.input?.task ?? "Task";

  // Handle approval state
  const approvalRequested = part.state === "approval-requested";

  // Handle denial
  const denied = part.state === "output-denied";
  const denialReason = denied ? part.approval?.reason : undefined;

  const treeChar = isLast ? "└─" : "├─";
  const continueChar = isLast ? "   " : "│  ";

  // Determine nested status line
  let nestedStatus = "";
  if (status === "complete") {
    nestedStatus = "Done";
  } else if (status === "interrupted") {
    nestedStatus = "Interrupted";
  } else if (denied) {
    nestedStatus = denialReason ? `Denied: ${denialReason}` : "Denied";
  } else if (approvalRequested) {
    nestedStatus = "Awaiting approval...";
  } else if (status === "pending") {
    nestedStatus = "Initializing...";
  } else if (status === "running" && (!lastTool || toolCount === 0)) {
    nestedStatus = "Initializing...";
  } else if (lastTool) {
    nestedStatus = lastTool.summary
      ? `${lastTool.name}(${lastTool.summary})`
      : lastTool.name;
  }
  const toolCountText = ` - ${toolCount} tool${toolCount !== 1 ? "s" : ""}`;
  const tokenText =
    tokenCount !== null ? ` - ${formatTokens(tokenCount)} tokens` : "";
  const approvalText = approvalRequested ? " [NEEDS APPROVAL]" : "";
  const timeText =
    isRunning && elapsedSeconds > 0 ? ` - ${formatTime(elapsedSeconds)}` : "";
  const suffixText = `${toolCountText}${tokenText}${approvalText}${timeText}`;
  const prefixLength = `${treeChar} `.length + 2;
  const maxDescWidth = Math.max(
    10,
    terminalWidth - prefixLength - suffixText.length,
  );
  const displayDesc = truncateText(desc, maxDescWidth);
  const nestedPrefixLength = `${continueChar}└ `.length;
  const maxNestedWidth = Math.max(10, terminalWidth - nestedPrefixLength);
  const displayNestedStatus = nestedStatus
    ? truncateText(nestedStatus, maxNestedWidth)
    : "";

  return (
    <box flexDirection="column">
      {/* Task row */}
      <box flexDirection="row">
        <text fg="gray">{treeChar} </text>
        <TaskStatusIndicator status={status} />
        <text> </text>
        <text fg={status === "error" || status === "denied" ? "red" : "white"}>
          {displayDesc}
        </text>
        <text fg="gray">{suffixText}</text>
      </box>

      {/* Nested status line */}
      {nestedStatus && (
        <box flexDirection="row">
          <text fg="gray">{continueChar}└ </text>
          <text
            fg={
              denied ? "red" : status === "interrupted" ? PRIMARY_COLOR : "gray"
            }
          >
            {displayNestedStatus}
          </text>
        </box>
      )}
    </box>
  );
}

type TaskGroupViewProps = {
  taskParts: TaskToolUIPart[];
  isStreaming: boolean;
};

export function TaskGroupView({ taskParts, isStreaming }: TaskGroupViewProps) {
  const { width } = useTerminalDimensions();
  if (taskParts.length === 0) return null;
  const terminalWidth = width ?? 80;

  // Count different states
  const hasApprovalPending = taskParts.some(
    (p) => getTaskStatus(p, isStreaming) === "approval-requested",
  );
  const runningCount = taskParts.filter((p) => {
    const status = getTaskStatus(p, isStreaming);
    return status === "running" || status === "pending";
  }).length;
  const interruptedCount = taskParts.filter(
    (p) => getTaskStatus(p, isStreaming) === "interrupted",
  ).length;
  const allComplete =
    runningCount === 0 && interruptedCount === 0 && !hasApprovalPending;
  const hasInterrupted = interruptedCount > 0;

  // Determine header text
  let headerText: string;
  if (allComplete) {
    headerText = `Completed ${taskParts.length} Task agent${taskParts.length > 1 ? "s" : ""}`;
  } else if (hasInterrupted && runningCount === 0) {
    headerText = `Interrupted ${taskParts.length} Task agent${taskParts.length > 1 ? "s" : ""}`;
  } else if (hasApprovalPending && runningCount === 0) {
    headerText = `${taskParts.length} Task agent${taskParts.length > 1 ? "s" : ""} (approval needed)`;
  } else {
    headerText = `Running ${taskParts.length} Task agent${taskParts.length > 1 ? "s" : ""}...`;
  }
  const headerMaxWidth = Math.max(10, terminalWidth - 4);
  const displayHeaderText = truncateText(headerText, headerMaxWidth);

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header */}
      <box flexDirection="row">
        {allComplete ? (
          <text fg="green">● </text>
        ) : hasInterrupted && runningCount === 0 ? (
          <text fg={PRIMARY_COLOR}>○ </text>
        ) : hasApprovalPending && runningCount === 0 ? (
          <text fg="white">● </text>
        ) : (
          <>
            <TaskSpinner />
            <text> </text>
          </>
        )}
        <text fg="white" attributes={TextAttributes.BOLD}>
          {displayHeaderText}
        </text>
      </box>

      {/* Task list */}
      <box flexDirection="column">
        {taskParts.map((part, index) => (
          <TaskItem
            key={part.toolCallId}
            part={part}
            isLast={index === taskParts.length - 1}
            isStreaming={isStreaming}
          />
        ))}
      </box>
    </box>
  );
}
