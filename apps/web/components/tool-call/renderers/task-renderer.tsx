"use client";

import { Loader2 } from "lucide-react";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

type TaskInput = {
  task?: string;
  subagentType?: string;
};

type MessagePart = {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
};

type UIMessage = {
  parts?: MessagePart[];
};

/**
 * Check if a part is a tool UI part.
 */
function isToolPart(part: MessagePart): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

/**
 * Check if a part is a text UI part.
 */
function isTextPart(part: MessagePart): boolean {
  return part.type === "text";
}

/**
 * Get tool name from a message part.
 */
function getToolName(part: MessagePart): string {
  if (part.toolName) {
    return part.toolName;
  }
  if (part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return "unknown";
}

function SubagentToolCall({ part }: { part: MessagePart }) {
  const toolName = getToolName(part);
  const isRunning =
    part.state === "input-streaming" || part.state === "input-available";
  const hasError = part.state === "output-error";

  const input = part.input;
  let summary = "";
  if (input?.filePath) {
    summary = String(input.filePath);
  } else if (input?.pattern) {
    summary = `"${input.pattern}"`;
  } else if (input?.command) {
    summary = String(input.command);
  } else if (input) {
    summary = JSON.stringify(input).slice(0, 40);
  }

  const dotColor = isRunning
    ? "bg-yellow-500"
    : hasError
      ? "bg-red-500"
      : "bg-green-500";
  const displayName = toolName.charAt(0).toUpperCase() + toolName.slice(1);

  return (
    <div className="flex items-center gap-2 border-l-2 border-border py-1 pl-3">
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
          <span className="max-w-[200px] truncate text-sm text-foreground">
            {summary}
          </span>
          <span className="text-sm text-muted-foreground">)</span>
        </>
      )}
      {hasError && <span className="text-sm text-red-500"> - error</span>}
    </div>
  );
}

export function TaskRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: {
  part: {
    input?: unknown;
    state: string;
    output?: unknown;
    approval?: { reason?: string; id?: string };
    preliminary?: boolean;
  };
  state: ToolRenderState;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const input = part.input as TaskInput | undefined;
  const desc = input?.task ?? "Spawning subagent";
  const subagentType = input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";
  const taskDenialReason = taskDenied ? part.approval?.reason : undefined;

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const message = hasOutput ? (part.output as UIMessage) : undefined;

  const messageParts = message?.parts ?? [];
  const relevantParts = messageParts.filter(
    (p) => isToolPart(p) || isTextPart(p),
  );
  const toolParts = messageParts.filter(isToolPart);

  const maxVisible = 4;
  const hiddenCount = Math.max(0, relevantParts.length - maxVisible);
  const visibleParts = relevantParts.slice(-maxVisible);

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
        : "Task";

  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
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
        <span className="truncate text-sm text-foreground">{desc}</span>
        <span className="text-muted-foreground">)</span>
      </div>

      {taskApprovalRequested && subagentType === "executor" && (
        <div className="mt-2 pl-5 text-sm text-yellow-500">
          This executor has full write access and can create, modify, and delete
          files.
        </div>
      )}

      {taskApprovalRequested && part.approval?.id && (
        <ApprovalButtons
          approvalId={part.approval.id}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}

      {taskDenied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied{taskDenialReason ? `: ${taskDenialReason}` : ""}
        </div>
      )}

      {hasOutput && visibleParts.length > 0 && (
        <div className="mt-3 space-y-1 pl-3">
          {hiddenCount > 0 && (
            <div className="text-sm text-muted-foreground">
              ... {hiddenCount} more above
            </div>
          )}
          {visibleParts.map((p, i) => {
            if (isToolPart(p)) {
              return <SubagentToolCall key={p.toolCallId ?? i} part={p} />;
            }
            if (isTextPart(p)) {
              const text = p.text?.trim() ?? "";
              if (!text) return null;
              const truncated =
                text.length > 80 ? text.slice(0, 80) + "..." : text;
              return (
                <div
                  key={`text-${i}`}
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

      {isComplete && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          Complete ({toolParts.length} tool calls)
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
