"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { TaskPendingToolCall, TaskToolUIPart } from "@open-harness/agent";
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

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as { role?: string }).role === "tool",
  ).length;
}

function getToolSummary(toolCall: TaskPendingToolCall): string {
  const input = toolCall.input as Record<string, unknown> | undefined;
  switch (toolCall.name) {
    case "read":
    case "write":
    case "edit": {
      const fp = input?.filePath ?? "";
      return fp ? toRelativePath(String(fp), DEFAULT_WORKING_DIRECTORY) : "";
    }
    case "grep":
    case "glob":
      return input?.pattern ? `"${input.pattern}"` : "";
    case "bash": {
      const cmd = input?.command ? String(input.command) : "";
      return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
    }
    default:
      return "";
  }
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
    (status === "running" && !pendingToolCall)
  ) {
    nestedStatus = "Initializing...";
  } else if (pendingToolCall) {
    const displayName =
      pendingToolCall.name.charAt(0).toUpperCase() +
      pendingToolCall.name.slice(1);
    const summary = getToolSummary(pendingToolCall);
    nestedStatus = summary ? `${displayName}(${summary})` : displayName;
  }

  return (
    <div className="flex">
      {/* Tree line */}
      <div className={cn("ml-1.5 mr-3 w-px", treeChar)} />

      <div className="flex-1 min-w-0 py-1">
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
          <div className="mt-0.5 flex items-center gap-1.5 pl-5 min-w-0">
            <span className="text-xs text-muted-foreground">-</span>
            <span
              className={cn(
                "text-xs truncate",
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
