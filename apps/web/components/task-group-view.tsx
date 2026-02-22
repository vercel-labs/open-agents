"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { isToolUIPart, getToolName } from "ai";
import type { TaskToolUIPart } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { cn } from "@/lib/utils";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ApprovalButtons } from "./tool-call/approval-buttons";

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
  const input = lastTool.input as Record<string, unknown> | undefined;

  let summary = "";
  if (input?.filePath) {
    summary = toRelativePath(String(input.filePath), DEFAULT_WORKING_DIRECTORY);
  } else if (input?.pattern) {
    summary = `"${input.pattern}"`;
  } else if (input?.command) {
    const cmd = String(input.command);
    summary = cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
  }

  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return { name: displayName, summary };
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

function TaskStatusIndicator({ status }: { status: TaskStatus }) {
  switch (status) {
    case "running":
    case "pending":
      return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
    case "approval-requested":
      return <span className="inline-block h-2 w-2 rounded-full bg-white" />;
    case "complete":
      return (
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
      );
    case "interrupted":
      return (
        <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
      );
    case "error":
    case "denied":
      return <span className="inline-block h-2 w-2 rounded-full bg-red-500" />;
    default:
      return (
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
      );
  }
}

function TaskItem({
  part,
  isLast,
  activeApprovalId,
  isStreaming,
  onApprove,
  onDeny,
}: {
  part: TaskToolUIPart;
  isLast: boolean;
  activeApprovalId: string | null;
  isStreaming: boolean;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const status = getTaskStatus(part, isStreaming);
  const isRunning = status === "running" || status === "pending";
  const elapsedSeconds = useTaskTiming(isRunning);
  const toolCount = countTaskTools(part);
  const tokenCount = getTaskTokens(part);
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

  const treeChar = isLast ? "bg-transparent" : "border-l border-border";

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
    <div className="flex">
      {/* Tree line */}
      <div className={cn("ml-1.5 mr-3 w-px", treeChar)} />

      <div className="flex-1 py-1">
        {/* Task row */}
        <div className="flex items-center gap-2 min-w-0">
          <TaskStatusIndicator status={status} />
          <span
            className={cn(
              "text-sm truncate",
              status === "error" || status === "denied"
                ? "text-red-500"
                : "text-foreground",
            )}
          >
            {desc}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            - {toolCount} tool{toolCount !== 1 ? "s" : ""}
            {tokenCount !== null && ` - ${formatTokens(tokenCount)} tokens`}
          </span>
          {approvalRequested && (
            <span className="text-xs text-yellow-500 shrink-0">
              [NEEDS APPROVAL]
            </span>
          )}
          {isRunning && elapsedSeconds > 0 && (
            <span className="hidden text-xs text-muted-foreground sm:inline shrink-0">
              - {formatTime(elapsedSeconds)}
            </span>
          )}
        </div>

        {/* Executor approval warning */}
        {approvalRequested && subagentType === "executor" && (
          <div className="mt-1 pl-5 text-xs text-yellow-500">
            This executor has full write access and can create, modify, and
            delete files.
          </div>
        )}

        {/* Approval buttons */}
        {isActiveApproval && approvalId && (
          <ApprovalButtons
            approvalId={approvalId}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        )}

        {/* Nested status line - only show if not showing approval buttons */}
        {nestedStatus && !isActiveApproval && (
          <div className="mt-0.5 flex items-center gap-1.5 pl-5">
            <span className="text-xs text-muted-foreground">-</span>
            <span
              className={cn(
                "text-xs",
                denied
                  ? "text-red-500"
                  : status === "interrupted"
                    ? "text-yellow-500"
                    : "text-muted-foreground",
              )}
            >
              {nestedStatus}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export type TaskGroupViewProps = {
  taskParts: TaskToolUIPart[];
  activeApprovalId: string | null;
  isStreaming: boolean;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
};

export function TaskGroupView({
  taskParts,
  activeApprovalId,
  isStreaming,
  onApprove,
  onDeny,
}: TaskGroupViewProps) {
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
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        {allComplete ? (
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        ) : hasInterrupted && runningCount === 0 ? (
          <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
        ) : hasApprovalPending && runningCount === 0 ? (
          <span className="inline-block h-2 w-2 rounded-full bg-white" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        )}
        <span className="font-medium text-foreground">{headerText}</span>
      </div>

      {/* Task list */}
      <div className="mt-2">
        {taskParts.map((part, index) => (
          <TaskItem
            key={part.toolCallId}
            part={part}
            isLast={index === taskParts.length - 1}
            activeApprovalId={activeApprovalId}
            isStreaming={isStreaming}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </div>
    </div>
  );
}
