import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { getToolName, isToolUIPart } from "ai";
import type { TaskToolUIPart } from "../../agent/tools/task-delegation/task.js";
import { ApprovalButtons } from "./tool-call.js";

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
  | "denied";

function getTaskStatus(part: TaskToolUIPart): TaskStatus {
  if (part.state === "approval-requested") return "approval-requested";
  if (part.state === "output-denied") return "denied";
  if (part.state === "output-error") return "error";
  if (part.state === "output-available" && !part.preliminary) return "complete";
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.preliminary)
  ) {
    return "running";
  }
  return "pending";
}

function countTaskTools(part: TaskToolUIPart): number {
  if (part.state !== "output-available") return 0;
  const message = part.output;
  if (!message?.parts) return 0;
  return message.parts.filter(isToolUIPart).length;
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
  if (!lastTool) return null;

  const toolName = getToolName(lastTool);
  const input = lastTool.input as Record<string, unknown> | undefined;

  let summary = "";
  if (input?.filePath) {
    summary = String(input.filePath);
  } else if (input?.pattern) {
    summary = `"${input.pattern}"`;
  } else if (input?.command) {
    const cmd = String(input.command);
    summary = cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
  }

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
  activeApprovalId,
}: {
  part: TaskToolUIPart;
  isLast: boolean;
  activeApprovalId: string | null;
}) {
  const status = getTaskStatus(part);
  const isRunning = status === "running" || status === "pending";
  const elapsedSeconds = useTaskTiming(isRunning);
  const toolCount = countTaskTools(part);
  const lastTool = getLastToolInfo(part);

  const desc = part.input?.task ?? "Task";

  const subagentType = part.input?.subagentType;

  // Handle approval state
  const approvalRequested = part.state === "approval-requested";
  const approvalId = approvalRequested ? part.approval?.id : undefined;
  const isActiveApproval =
    approvalId != null && approvalId === activeApprovalId;

  // Handle denial
  const denied = part.state === "output-denied";
  const denialReason = denied ? part.approval?.reason : undefined;

  const treeChar = isLast ? "└─" : "├─";
  const continueChar = isLast ? "   " : "│  ";

  // Determine nested status line
  let nestedStatus = "";
  if (status === "complete") {
    nestedStatus = "Done";
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
        </Text>
        {approvalRequested && <Text color="yellow"> [NEEDS APPROVAL]</Text>}
        {isRunning && elapsedSeconds > 0 && (
          <Text color="gray"> - {formatTime(elapsedSeconds)}</Text>
        )}
      </Box>

      {/* Executor approval warning */}
      {approvalRequested && subagentType === "executor" && (
        <Box paddingLeft={4}>
          <Text color="yellow">
            This executor has full write access and can create, modify, and
            delete files.
          </Text>
        </Box>
      )}

      {/* Approval buttons */}
      {isActiveApproval && approvalId && (
        <ApprovalButtons approvalId={approvalId} />
      )}

      {/* Nested status line - only show if not showing approval buttons */}
      {nestedStatus && !isActiveApproval && (
        <Box>
          <Text color="gray">{continueChar}└ </Text>
          <Text color={denied ? "red" : "gray"}>{nestedStatus}</Text>
        </Box>
      )}
    </Box>
  );
}

type TaskGroupViewProps = {
  taskParts: TaskToolUIPart[];
  activeApprovalId: string | null;
};

export function TaskGroupView({
  taskParts,
  activeApprovalId,
}: TaskGroupViewProps) {
  if (taskParts.length === 0) return null;

  // Count different states
  const hasApprovalPending = taskParts.some(
    (p) => getTaskStatus(p) === "approval-requested",
  );
  const runningCount = taskParts.filter((p) => {
    const status = getTaskStatus(p);
    return status === "running" || status === "pending";
  }).length;
  const allComplete = runningCount === 0 && !hasApprovalPending;

  // Determine header text
  let headerText: string;
  if (allComplete) {
    headerText = `Completed ${taskParts.length} Task agent${taskParts.length > 1 ? "s" : ""}`;
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
            activeApprovalId={activeApprovalId}
          />
        ))}
      </Box>
    </Box>
  );
}
