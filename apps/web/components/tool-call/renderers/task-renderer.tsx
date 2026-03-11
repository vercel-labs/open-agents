"use client";

import type { TaskPendingToolCall } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ToolLayout } from "../tool-layout";

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
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { role?: string }).role === "tool",
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
  const displayName =
    toolCall.name.charAt(0).toUpperCase() + toolCall.name.slice(1);

  return (
    <div className="border-l-2 border-border py-1 pl-3">
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-yellow-500" />
        ) : (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
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
  const input = part.input;
  const desc = input?.task ?? "Spawning subagent";
  const fullPrompt = input?.instructions;
  const subagentType = input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const isComplete = hasOutput && !isPreliminary;
  const output = hasOutput ? part.output : undefined;

  const pendingToolCall = output?.pending ?? null;
  const toolCount =
    output?.toolCallCount ?? (isComplete ? countToolCalls(output?.final) : 0);

  const isTaskStreaming = hasOutput && isPreliminary;
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

  const hasExpandableContent =
    pendingToolCall !== null ||
    (fullPrompt && fullPrompt.length > 80) ||
    isComplete;

  const indicator = state.interrupted ? (
    <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
  ) : state.running || isActuallyRunning ? (
    <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
  ) : (
    <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
  );

  const meta = pendingToolCall ? (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 overflow-hidden">
      <span className={cn(isPreliminary && "text-yellow-500")}>
        {pendingToolCall.name}
      </span>
      {getToolSummary(pendingToolCall) && (
        <span className="truncate text-muted-foreground">
          {getToolSummary(pendingToolCall)}
        </span>
      )}
    </span>
  ) : isComplete ? (
    <span className="inline-flex items-center gap-1.5">
      <span>
        {toolCount} tool{toolCount === 1 ? "" : "s"}
      </span>
      {output?.usage?.inputTokens ? (
        <span>{formatTokens(output.usage.inputTokens)} tokens</span>
      ) : null}
    </span>
  ) : undefined;

  const expandedContent = hasExpandableContent ? (
    <div className="space-y-3">
      {fullPrompt && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Task prompt
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
            {fullPrompt}
          </pre>
        </div>
      )}

      {subagentType && (
        <div>
          <span className="text-xs text-muted-foreground">Subagent type: </span>
          <span className="text-sm text-foreground">{subagentType}</span>
        </div>
      )}

      {pendingToolCall && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Current tool call
          </div>
          <SubagentToolCall
            toolCall={pendingToolCall}
            isRunning={isPreliminary}
            expanded
          />
        </div>
      )}

      {isComplete && (
        <div className="text-sm text-muted-foreground">
          Complete ({toolCount} tool calls
          {output?.usage?.inputTokens
            ? `, ${formatTokens(output.usage.inputTokens)} tokens`
            : ""}
          )
        </div>
      )}
    </div>
  ) : undefined;

  const approvalWarning =
    taskApprovalRequested && subagentType === "executor" ? (
      <div className="mt-2 pl-5 text-sm text-yellow-500">
        This executor has full write access and can create, modify, and delete
        files.
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name={subagentLabel}
      summary={desc}
      meta={meta}
      state={state}
      indicator={indicator}
      nameClassName={taskDenied ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    >
      {approvalWarning}
    </ToolLayout>
  );
}
