import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { getToolName, isToolUIPart } from "ai";
import type { TaskToolUIPart, SubagentUIMessage } from "@open-harness/agent";
import { formatTokens } from "@open-harness/shared";

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

  return <Text color="gray">{SPINNER_FRAMES[frame]}</Text>;
}

function FlashingDot() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return <Text color="gray">{visible ? "●" : " "}</Text>;
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
  // Use totalMessageUsage when complete, lastStepUsage when still running
  const isComplete = !part.preliminary;
  if (isComplete) {
    return message?.metadata?.totalMessageUsage?.inputTokens ?? null;
  }
  return message?.metadata?.lastStepUsage?.inputTokens ?? null;
}

function getToolSummary(part: SubagentMessagePart): string {
  switch (part.type) {
    case "tool-read":
    case "tool-write":
    case "tool-edit":
      return part.input?.filePath ?? "";
    case "tool-grep":
    case "tool-glob":
      return part.input?.pattern ? `"${part.input.pattern}"` : "";
    case "tool-bash": {
      const cmd = part.input?.command ?? "";
      return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
    }
    default:
      return "";
  }
}

function getLastToolInfo(
  part: TaskToolUIPart,
): { name: string; summary: string } | null {
  if (part.state !== "output-available") return null;
  const message = part.output;
  if (!message?.parts) return null;

  const toolParts = message.parts.filter(isToolUIPart);
  if (toolParts.length === 0) return null;

  const lastTool = toolParts[toolParts.length - 1];
  // Double-check needed for TypeScript narrowing with union types
  if (!lastTool || !isToolUIPart(lastTool)) return null;

  const toolName = getToolName(lastTool);
  const summary = getToolSummary(lastTool);

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
      return <Text color="white">●</Text>;
    case "complete":
      return <Text color="green">✓</Text>;
    case "interrupted":
      return <Text color="yellow">○</Text>;
    case "error":
    case "denied":
      return <Text color="red">✗</Text>;
    default:
      return <Text color="gray">●</Text>;
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
  const lastTool = getLastToolInfo(part);

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
  } else if (
    status === "pending" ||
    (status === "running" && toolCount === 0)
  ) {
    nestedStatus = "Initializing...";
  } else if (lastTool) {
    nestedStatus = lastTool.summary
      ? `${lastTool.name}(${lastTool.summary})`
      : lastTool.name;
  }

  return (
    <Box flexDirection="column">
      {/* Task row */}
      <Box>
        <Text color="gray">{treeChar} </Text>
        <TaskStatusIndicator status={status} />
        <Text> </Text>
        <Text
          color={status === "error" || status === "denied" ? "red" : "white"}
        >
          {desc}
        </Text>
        <Text color="gray">
          {" "}
          - {toolCount} tool{toolCount !== 1 ? "s" : ""}
          {tokenCount !== null && ` - ${formatTokens(tokenCount)} tokens`}
        </Text>
        {approvalRequested && <Text color="yellow"> [NEEDS APPROVAL]</Text>}
        {isRunning && elapsedSeconds > 0 && (
          <Text color="gray"> - {formatTime(elapsedSeconds)}</Text>
        )}
      </Box>

      {/* Nested status line */}
      {nestedStatus && (
        <Box>
          <Text color="gray">{continueChar}└ </Text>
          <Text
            color={
              denied ? "red" : status === "interrupted" ? "yellow" : "gray"
            }
          >
            {nestedStatus}
          </Text>
        </Box>
      )}
    </Box>
  );
}

type TaskGroupViewProps = {
  taskParts: TaskToolUIPart[];
  isStreaming: boolean;
};

export function TaskGroupView({ taskParts, isStreaming }: TaskGroupViewProps) {
  if (taskParts.length === 0) return null;

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

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Header */}
      <Box>
        {allComplete ? (
          <Text color="green">● </Text>
        ) : hasInterrupted && runningCount === 0 ? (
          <Text color="yellow">○ </Text>
        ) : hasApprovalPending && runningCount === 0 ? (
          <Text color="white">● </Text>
        ) : (
          <>
            <TaskSpinner />
            <Text> </Text>
          </>
        )}
        <Text bold color="white">
          {headerText}
        </Text>
      </Box>

      {/* Task list */}
      <Box flexDirection="column">
        {taskParts.map((part, index) => (
          <TaskItem
            key={part.toolCallId}
            part={part}
            isLast={index === taskParts.length - 1}
            isStreaming={isStreaming}
          />
        ))}
      </Box>
    </Box>
  );
}
