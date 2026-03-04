"use client";

import type { TaskPendingToolCall } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

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
    case "bash":
      return input?.command ? String(input.command) : "";
    default:
      return "";
  }
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

function SubagentToolCall({
  toolCall,
  isRunning,
  expanded = false,
}: {
  toolCall: TaskPendingToolCall;
  isRunning: boolean;
  expanded?: boolean;
}) {
  const summary = getToolSummary(toolCall);

  const dotColor = isRunning ? "bg-yellow-500" : "bg-green-500";
  const displayName =
    toolCall.name.charAt(0).toUpperCase() + toolCall.name.slice(1);

  return (
    <div className="border-l-2 border-border py-1 pl-3">
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-yellow-500" />
        ) : (
          <span
            className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor)}
          />
        )}
        <span
          className={cn(
            "text-sm font-medium",
            isRunning ? "text-yellow-500" : "text-foreground",
          )}
        >
          {displayName}
        </span>
        {summary && (
          <>
            <span className="text-sm text-muted-foreground">(</span>
            <span
              className={cn(
                "text-sm text-foreground",
                expanded ? "" : "max-w-[200px] truncate",
              )}
            >
              {summary}
            </span>
            <span className="text-sm text-muted-foreground">)</span>
          </>
        )}
      </div>
      {/* Show full input in expanded mode */}
      {expanded && (
        <pre className="ml-4 mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
          {JSON.stringify(toolCall.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function TaskRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-task">) {
  const [isExpanded, setIsExpanded] = useState(false);

  const input = part.input;
  const desc = input?.task ?? "Spawning subagent";
  const fullPrompt = input?.instructions;
  const subagentType = input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";
  const taskDenialReason = taskDenied ? part.approval?.reason : undefined;

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const isComplete = hasOutput && !isPreliminary;
  const output = hasOutput ? part.output : undefined;

  const pendingToolCall = output?.pending ?? null;
  const toolCount =
    output?.toolCallCount ?? (isComplete ? countToolCalls(output?.final) : 0);

  const isTaskStreaming = hasOutput && isPreliminary;

  // Compute running states using state.interrupted from shared extractRenderState
  const isRunningState =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    isTaskStreaming;
  const isActuallyRunning = isRunningState && !state.interrupted;

  const dotColor = taskDenied
    ? "bg-red-500"
    : taskApprovalRequested
      ? "bg-yellow-500"
      : state.interrupted
        ? "bg-yellow-500"
        : isActuallyRunning
          ? "bg-yellow-500"
          : isComplete
            ? "bg-green-500"
            : "bg-yellow-500";

  const subagentLabel =
    subagentType === "explorer"
      ? "Explorer"
      : subagentType === "executor"
        ? "Executor"
        : subagentType === "general"
          ? "General"
          : "Task";

  // Has expandable content if there's a pending tool call or the prompt is long
  const hasExpandableContent =
    pendingToolCall !== null ||
    (fullPrompt && fullPrompt.length > 80) ||
    isComplete;

  const handleClick = () => {
    if (hasExpandableContent) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hasExpandableContent) {
        setIsExpanded(!isExpanded);
      }
    }
  };

  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          hasExpandableContent && "cursor-pointer",
        )}
        {...(hasExpandableContent && {
          onClick: handleClick,
          onKeyDown: handleKeyDown,
          role: "button",
          tabIndex: 0,
          "aria-expanded": isExpanded,
        })}
      >
        {state.interrupted ? (
          <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
        ) : state.running || isActuallyRunning ? (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        ) : (
          <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
        )}
        <span
          className={cn(
            "font-medium",
            taskDenied ? "text-red-500" : "text-foreground",
          )}
        >
          {subagentLabel}
        </span>
        <span className="text-muted-foreground">(</span>
        <span className="truncate text-sm text-foreground">
          {desc.length > 60 ? desc.slice(0, 60) + "..." : desc}
        </span>
        <span className="text-muted-foreground">)</span>
      </div>

      {taskApprovalRequested && subagentType === "executor" && (
        <div className="mt-2 pl-5 text-sm text-yellow-500">
          This executor has full write access and can create, modify, and delete
          files.
        </div>
      )}

      {taskApprovalRequested && part.approval?.id && (
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <ApprovalButtons
            approvalId={part.approval.id}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        </div>
      )}

      {taskDenied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied{taskDenialReason ? `: ${taskDenialReason}` : ""}
        </div>
      )}

      {/* Collapsed view - show current pending tool call */}
      {!isExpanded && pendingToolCall && (
        <div className="mt-3 space-y-1 pl-3">
          <SubagentToolCall
            toolCall={pendingToolCall}
            isRunning={isPreliminary}
          />
        </div>
      )}

      {/* Expanded view - show prompt and current tool call details */}
      {isExpanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* Full prompt */}
          {fullPrompt && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Task Prompt
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
                {fullPrompt}
              </pre>
            </div>
          )}

          {/* Subagent type */}
          {subagentType && (
            <div>
              <span className="text-xs text-muted-foreground">
                Subagent Type:{" "}
              </span>
              <span className="text-sm text-foreground">{subagentType}</span>
            </div>
          )}

          {/* Current tool call */}
          {pendingToolCall && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Current Tool Call
              </div>
              <SubagentToolCall
                toolCall={pendingToolCall}
                isRunning={isPreliminary}
                expanded
              />
            </div>
          )}
        </div>
      )}

      {!isExpanded && isComplete && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          Complete ({toolCount} tool calls
          {output?.usage?.inputTokens
            ? `, ${formatTokens(output.usage.inputTokens)} tokens`
            : ""}
          )
        </div>
      )}

      {state.interrupted && (
        <div className="mt-2 pl-5 text-sm text-yellow-500">Interrupted</div>
      )}

      {state.error && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Error: {state.error.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
