"use client";

import type { TaskPendingToolCall } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { Hammer, Loader2, Paintbrush, Telescope } from "lucide-react";
import type { ReactNode } from "react";
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
      return "Executor Subagent";
    case "design":
      return "Design Subagent";
    default:
      return "Explorer Subagent";
  }
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
          <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
        ) : (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
        )}
        <span
          className={cn(
            "text-sm font-medium",
            isRunning ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {displayName}
        </span>
        {summary && (
          <span
            className={cn(
              "font-mono text-xs text-muted-foreground",
              expanded ? "" : "max-w-[200px] truncate",
            )}
          >
            {summary}
          </span>
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
  const tokenCount = output?.usage?.inputTokens ?? null;

  // Build mono stats for meta
  const statParts: string[] = [];
  if (toolCount > 0) {
    statParts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  }
  if (tokenCount !== null) {
    statParts.push(`${formatTokens(tokenCount)} tokens`);
  }

  const meta =
    statParts.length > 0 ? (
      <span className="font-mono text-xs text-muted-foreground">
        {statParts.join(" · ")}
      </span>
    ) : null;

  const hasExpandableContent =
    pendingToolCall !== null ||
    (fullPrompt && fullPrompt.length > 80) ||
    isComplete;

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
        <div className="font-mono text-xs text-muted-foreground">
          Complete ({toolCount} tool calls
          {tokenCount !== null ? `, ${formatTokens(tokenCount)} tokens` : ""})
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
      name={getSubagentLabel(subagentType)}
      summary={desc}
      meta={meta}
      state={state}
      icon={getSubagentIcon(subagentType, "h-3.5 w-3.5")}
      nameClassName={taskDenied ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    >
      {approvalWarning}
    </ToolLayout>
  );
}
