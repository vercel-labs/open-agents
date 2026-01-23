"use client";

import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { createNewFileCodeLines } from "@open-harness/shared/lib/diff";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

export function WriteRenderer({
  part,
  state,
  cwd = "",
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-write">) {
  const [isExpanded, setIsExpanded] = useState(false);
  const input = part.input;
  const rawFilePath = input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const content = input?.content ?? "";

  const { lines, totalLines, hiddenLines } = createNewFileCodeLines(
    content,
    rawFilePath,
    undefined,
    10,
  );

  const output = part.state === "output-available" ? part.output : undefined;
  const outputError =
    output?.success === false ? (output?.error ?? "Write failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const showCode =
    mergedState.approvalRequested ||
    (!mergedState.running && !mergedState.error && !mergedState.denied);

  const dotColor = mergedState.denied
    ? "bg-red-500"
    : mergedState.approvalRequested
      ? "bg-yellow-500"
      : mergedState.running
        ? "bg-yellow-500"
        : mergedState.error
          ? "bg-red-500"
          : "bg-green-500";

  // Has expandable content if there are hidden lines or content is substantial
  const hasExpandableContent = hiddenLines > 0 || totalLines > 10;

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
    <div
      className={cn(
        "my-2 rounded-lg border border-border bg-card p-3",
        hasExpandableContent && "cursor-pointer hover:bg-accent/50",
      )}
      {...(hasExpandableContent && {
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        role: "button",
        tabIndex: 0,
        "aria-expanded": isExpanded,
      })}
    >
      <div className="flex items-center gap-2">
        {mergedState.interrupted ? (
          <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
        ) : mergedState.running ? (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        ) : (
          <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
        )}
        <span className="font-medium text-foreground">Create</span>
        <span className="text-muted-foreground">(</span>
        <span className="truncate text-sm text-foreground">{filePath}</span>
        <span className="text-muted-foreground">)</span>
      </div>

      {mergedState.approvalRequested && mergedState.isActiveApproval && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          Running...
        </div>
      )}

      {mergedState.approvalRequested &&
        !mergedState.isActiveApproval &&
        mergedState.approvalId && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <ApprovalButtons
              approvalId={mergedState.approvalId}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          </div>
        )}

      {/* Collapsed preview */}
      {!isExpanded &&
        showCode &&
        !mergedState.approvalRequested &&
        !mergedState.denied && (
          <>
            <div className="mt-2 pl-5 text-sm">
              <span>Created </span>
              <span className="font-medium">{filePath}</span>
              <span className="text-muted-foreground">
                {" "}
                ({totalLines} line{totalLines !== 1 ? "s" : ""})
              </span>
            </div>

            {lines.length > 0 && (
              <div className="ml-5 mt-2 overflow-hidden rounded border border-border bg-muted p-2 font-mono text-xs">
                {lines.map((line, i) => (
                  <div key={i} className="truncate text-foreground">
                    {line.content}
                  </div>
                ))}
                {hiddenLines > 0 && (
                  <div className="text-muted-foreground">
                    ... {hiddenLines} more line{hiddenLines !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
            )}
          </>
        )}

      {/* Expanded full content */}
      {isExpanded && showCode && !mergedState.denied && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-2 text-sm">
            <span>Created </span>
            <span className="font-medium">{filePath}</span>
            <span className="text-muted-foreground">
              {" "}
              ({totalLines} line{totalLines !== 1 ? "s" : ""})
            </span>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Full Content
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted p-2 font-mono text-xs text-foreground">
              {content}
            </pre>
          </div>
        </div>
      )}

      {mergedState.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied
          {mergedState.denialReason ? `: ${mergedState.denialReason}` : ""}
        </div>
      )}

      {mergedState.error && !mergedState.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Error: {mergedState.error.slice(0, 80)}
        </div>
      )}

      {mergedState.interrupted && (
        <div className="mt-2 pl-5 text-sm text-yellow-500">Interrupted</div>
      )}
    </div>
  );
}
