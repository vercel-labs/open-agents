"use client";

import type { SubagentUIMessage } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

type SubagentMessagePart = SubagentUIMessage["parts"][number];

type KeyedSubagentPart = {
  part: SubagentMessagePart;
  renderKey: string;
};

function getRelevantPartRenderEntries(
  messageParts: SubagentMessagePart[],
): KeyedSubagentPart[] {
  const entries: KeyedSubagentPart[] = [];
  let textOrdinal = 0;
  let toolOrdinal = 0;

  for (const part of messageParts) {
    if (isToolUIPart(part)) {
      entries.push({
        part,
        renderKey: part.toolCallId ?? `tool:${part.type}:${toolOrdinal}`,
      });
      toolOrdinal += 1;
      continue;
    }

    if (isTextUIPart(part)) {
      entries.push({
        part,
        renderKey: `text:${textOrdinal}`,
      });
      textOrdinal += 1;
    }
  }

  return entries;
}

function getToolSummary(part: SubagentMessagePart): string {
  switch (part.type) {
    case "tool-read":
    case "tool-write":
    case "tool-edit": {
      const fp = part.input?.filePath ?? "";
      return fp ? toRelativePath(fp, DEFAULT_WORKING_DIRECTORY) : "";
    }
    case "tool-grep":
    case "tool-glob":
      return part.input?.pattern ? `"${part.input.pattern}"` : "";
    case "tool-bash":
      return part.input?.command ?? "";
    default:
      return "";
  }
}

function SubagentToolCall({
  part,
  expanded = false,
}: {
  part: SubagentMessagePart;
  expanded?: boolean;
}) {
  if (!isToolUIPart(part)) return null;

  const toolName = getToolName(part);
  const isRunning =
    part.state === "input-streaming" || part.state === "input-available";
  const hasError = part.state === "output-error";

  const summary = getToolSummary(part);

  const dotColor = isRunning
    ? "bg-yellow-500"
    : hasError
      ? "bg-red-500"
      : "bg-green-500";
  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);

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
        {hasError ? (
          <span className="text-sm text-red-500"> - error</span>
        ) : null}
      </div>
      {/* Show full input in expanded mode */}
      {expanded && (
        <pre className="ml-4 mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
          {JSON.stringify(part.input, null, 2)}
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
  const message = hasOutput ? part.output : undefined;

  const messageParts = message?.parts ?? [];
  const relevantPartEntries = getRelevantPartRenderEntries(messageParts);
  const relevantParts = relevantPartEntries.map((entry) => entry.part);
  const toolParts = messageParts.filter(isToolUIPart);
  const textParts = messageParts.filter(isTextUIPart);

  const maxVisible = 4;
  const hiddenCount = Math.max(0, relevantPartEntries.length - maxVisible);
  const visibleParts = relevantPartEntries.slice(-maxVisible);

  const isComplete = hasOutput && !isPreliminary;
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

  // Has expandable content if there are tool parts or the prompt is long
  const hasExpandableContent =
    toolParts.length > 0 ||
    (fullPrompt && fullPrompt.length > 80) ||
    textParts.length > 0;

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

      {/* Collapsed view - show last 4 parts */}
      {!isExpanded && hasOutput && visibleParts.length > 0 && (
        <div className="mt-3 space-y-1 pl-3">
          {hiddenCount > 0 && (
            <div className="text-sm text-muted-foreground">
              ... {hiddenCount} more above
            </div>
          )}
          {visibleParts.map(({ part: p, renderKey }) => {
            if (isToolUIPart(p)) {
              return <SubagentToolCall key={renderKey} part={p} />;
            }
            if (isTextUIPart(p)) {
              const text = p.text?.trim() ?? "";
              if (!text) return null;
              const truncated =
                text.length > 80 ? text.slice(0, 80) + "..." : text;
              return (
                <div
                  key={renderKey}
                  className="border-l-2 border-border py-1 pl-3 text-sm text-muted-foreground"
                >
                  {truncated}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}

      {/* Expanded view - show all parts with full details */}
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

          {/* All tool calls */}
          {relevantParts.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Tool Calls ({toolParts.length})
              </div>
              <div className="max-h-96 space-y-1 overflow-auto">
                {relevantPartEntries.map(({ part: p, renderKey }) => {
                  if (isToolUIPart(p)) {
                    return (
                      <SubagentToolCall key={renderKey} part={p} expanded />
                    );
                  }
                  if (isTextUIPart(p)) {
                    const text = p.text?.trim() ?? "";
                    if (!text) return null;
                    return (
                      <div
                        key={renderKey}
                        className="border-l-2 border-border py-1 pl-3 text-sm text-muted-foreground"
                      >
                        {text}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!isExpanded && isComplete && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          Complete ({toolParts.length} tool calls
          {message?.metadata?.totalMessageUsage?.inputTokens
            ? `, ${formatTokens(message.metadata.totalMessageUsage.inputTokens)} tokens`
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
