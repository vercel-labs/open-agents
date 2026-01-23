"use client";

import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { createEditDiffLines } from "@open-harness/shared/lib/diff";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

export function EditRenderer({
  part,
  state,
  cwd = "",
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-edit">) {
  const [isExpanded, setIsExpanded] = useState(false);
  const input = part.input;
  const rawFilePath = input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const oldString = input?.oldString ?? "";
  const newString = input?.newString ?? "";

  // Collapsed view: limited to 10 lines
  const { lines, additions, removals } = createEditDiffLines(
    oldString,
    newString,
    1,
    10,
  );

  // Expanded view: show all lines (up to 500)
  const fullDiff = createEditDiffLines(oldString, newString, 3, 500);

  const output = part.state === "output-available" ? part.output : undefined;
  const outputError =
    output?.success === false ? (output?.error ?? "Edit failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const showDiff =
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

  // Has expandable content if the diff is large
  const hasExpandableContent =
    fullDiff.lines.length > lines.length ||
    oldString.length > 200 ||
    newString.length > 200;

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

  const renderDiffLines = (
    diffLines: ReturnType<typeof createEditDiffLines>["lines"],
  ) => (
    <div className="overflow-hidden rounded border border-border bg-muted font-mono text-xs">
      {diffLines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex",
            line.type === "addition" && "bg-green-950/50",
            line.type === "removal" && "bg-red-950/50",
          )}
        >
          {line.type === "separator" ? (
            <span className="px-2 py-0.5 text-muted-foreground">
              {line.content}
            </span>
          ) : (
            <>
              <span className="w-10 shrink-0 px-2 py-0.5 text-right text-muted-foreground">
                {line.lineNumber ?? ""}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 py-0.5 text-center",
                  line.type === "addition" && "text-green-500",
                  line.type === "removal" && "text-red-500",
                )}
              >
                {line.type === "addition"
                  ? "+"
                  : line.type === "removal"
                    ? "-"
                    : " "}
              </span>
              <span className="truncate py-0.5 pr-2 text-foreground">
                {isExpanded ? line.content : line.content.slice(0, 80)}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );

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
        <span className="font-medium text-foreground">Update</span>
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
        showDiff &&
        !mergedState.approvalRequested &&
        !mergedState.denied && (
          <>
            <div className="mt-2 pl-5 text-sm">
              <span>Updated </span>
              <span className="font-medium">{filePath}</span>
              <span> with </span>
              <span className="text-green-500">
                {additions} addition{additions !== 1 ? "s" : ""}
              </span>
              <span> and </span>
              <span className="text-red-500">
                {removals} removal{removals !== 1 ? "s" : ""}
              </span>
            </div>

            {lines.length > 0 && (
              <div className="ml-5 mt-2">{renderDiffLines(lines)}</div>
            )}
          </>
        )}

      {/* Expanded full diff */}
      {isExpanded && showDiff && !mergedState.denied && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="text-sm">
            <span>Updated </span>
            <span className="font-medium">{filePath}</span>
            <span> with </span>
            <span className="text-green-500">
              {fullDiff.additions} addition{fullDiff.additions !== 1 ? "s" : ""}
            </span>
            <span> and </span>
            <span className="text-red-500">
              {fullDiff.removals} removal{fullDiff.removals !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Full diff view */}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Full Diff
            </div>
            <div className="max-h-96 overflow-auto">
              {renderDiffLines(fullDiff.lines)}
            </div>
          </div>

          {/* Raw old/new strings for debugging */}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Old String
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-red-950/20 p-2 font-mono text-xs text-foreground">
                {oldString || "(empty)"}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                New String
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-green-950/20 p-2 font-mono text-xs text-foreground">
                {newString || "(empty)"}
              </pre>
            </div>
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
