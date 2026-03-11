import type { TaskPendingToolCall, TaskToolUIPart } from "@open-harness/agent";
import { formatTokens } from "@open-harness/shared";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React, { useEffect, useRef, useState } from "react";
import { useChatContext } from "../chat-context";
import { PRIMARY_COLOR } from "../lib/colors";
import { truncateText } from "../lib/truncate";
import { toRelativePath } from "./tool-renderers/shared";

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

function useTaskTiming(isRunning: boolean, startedAtMs?: number) {
  const fallbackStartRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    if (startedAtMs == null && !fallbackStartRef.current) {
      fallbackStartRef.current = Date.now();
    }

    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startedAtMs]);

  const effectiveStart = startedAtMs ?? fallbackStartRef.current;
  if (!isRunning || effectiveStart == null) {
    return 0;
  }

  return Math.max(0, Math.floor((now - effectiveStart) / 1000));
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

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as { role?: string }).role === "tool",
  ).length;
}

function getToolSummary(toolCall: TaskPendingToolCall, cwd: string): string {
  const input = toolCall.input as Record<string, unknown> | undefined;
  switch (toolCall.name) {
    case "read":
    case "write":
    case "edit":
      return input?.filePath ? toRelativePath(String(input.filePath), cwd) : "";
    case "grep":
    case "glob":
      return input?.pattern ? `"${input.pattern}"` : "";
    case "bash": {
      return input?.command ? String(input.command) : "";
    }
    default:
      return "";
  }
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
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;

  const hasOutput = part.state === "output-available";
  const isComplete = hasOutput && !part.preliminary;
  const output = hasOutput ? part.output : undefined;
  const startedAt =
    typeof output?.startedAt === "number" ? output.startedAt : undefined;
  const elapsedSeconds = useTaskTiming(isRunning, startedAt);

  const pendingToolCall: TaskPendingToolCall | null = output?.pending ?? null;
  const toolCount =
    output?.toolCallCount ?? (isComplete ? countToolCalls(output?.final) : 0);
  const tokenCount = output?.usage?.inputTokens ?? null;

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
  } else if (status === "running" && !pendingToolCall) {
    nestedStatus = "Initializing...";
  } else if (pendingToolCall) {
    const displayName =
      pendingToolCall.name.charAt(0).toUpperCase() +
      pendingToolCall.name.slice(1);
    const summary = getToolSummary(pendingToolCall, cwd);
    nestedStatus = summary ? `${displayName}(${summary})` : displayName;
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
