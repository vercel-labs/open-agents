"use client";

import { useState, useEffect, useRef } from "react";
import { Hammer, Loader2, Paintbrush, Telescope } from "lucide-react";
import type { TaskPendingToolCall, TaskToolUIPart } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { cn } from "@/lib/utils";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ApprovalButtons } from "./tool-call/approval-buttons";
import type { ReactNode } from "react";

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

function getSubagentIcon(
  subagentType: string | undefined,
  className: string,
): ReactNode {
  switch (subagentType) {
    case "executor":
      return <Hammer className={className} />;
    case "design":
      return <Paintbrush className={className} />;
    default:
      return <Telescope className={className} />;
  }
}

function getSubagentLabel(subagentType: string | undefined): string {
  switch (subagentType) {
    case "executor":
      return "Executor";
    case "design":
      return "Design";
    default:
      return "Explorer";
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

  // Build mono stats
  const statParts: string[] = [];
  if (toolCount > 0) {
    statParts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  }
  if (tokenCount !== null) {
    statParts.push(`${formatTokens(tokenCount)} tokens`);
  }
  if (isRunning && elapsedSeconds > 0) {
    statParts.push(formatTime(elapsedSeconds));
  }

  // Determine nested status line
  let nestedStatus = "";
  if (status === "complete") {
    // No nested status for completed tasks — the header already indicates completion
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

      <div className="min-w-0 flex-1 py-0.5">
        {/* Task row */}
        <div className="flex min-w-0 items-center gap-2">
          {/* Type-specific icon */}
          <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              getSubagentIcon(subagentType, "h-3.5 w-3.5")
            )}
          </span>
          <span className="shrink-0 text-sm font-medium text-foreground">
            {getSubagentLabel(subagentType)}
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              status === "error" || status === "denied"
                ? "text-red-500"
                : "text-muted-foreground",
            )}
          >
            {desc}
          </span>
          {statParts.length > 0 && (
            <span className="hidden shrink-0 font-mono text-xs text-muted-foreground/60 sm:inline">
              {statParts.join(" · ")}
            </span>
          )}
          {approvalRequested && (
            <span className="shrink-0 text-xs text-yellow-500">
              [NEEDS APPROVAL]
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
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-5">
            <span className="font-mono text-xs text-muted-foreground/50">
              →
            </span>
            <span
              className={cn(
                "truncate font-mono text-xs",
                denied
                  ? "text-red-500"
                  : status === "interrupted"
                    ? "text-yellow-500"
                    : "text-muted-foreground/60",
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

  let headerText: string;
  if (allComplete) {
    headerText = `${taskParts.length} subagent${taskParts.length > 1 ? "s" : ""} completed`;
  } else if (hasInterrupted && runningCount === 0) {
    headerText = `${taskParts.length} subagent${taskParts.length > 1 ? "s" : ""} interrupted`;
  } else if (hasApprovalPending && runningCount === 0) {
    headerText = `${taskParts.length} subagent${taskParts.length > 1 ? "s" : ""} (approval needed)`;
  } else {
    headerText = `Running ${taskParts.length} subagent${taskParts.length > 1 ? "s" : ""}...`;
  }

  return (
    <div className="my-1 rounded-lg border border-border bg-card px-3 py-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        {allComplete ? (
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        ) : hasInterrupted && runningCount === 0 ? (
          <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
        ) : hasApprovalPending && runningCount === 0 ? (
          <span className="inline-block h-2 w-2 rounded-full bg-white" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">
          {headerText}
        </span>
      </div>

      {/* Task list */}
      <div className="mt-1">
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
