"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { MultiFileDiff } from "@pierre/diffs/react";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { defaultDiffOptions } from "@/lib/diffs-config";
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

  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  // Count additions and removals using multiset comparison to handle duplicate lines
  const oldCounts = new Map<string, number>();
  for (const l of oldLines) oldCounts.set(l, (oldCounts.get(l) ?? 0) + 1);
  const newCounts = new Map<string, number>();
  for (const l of newLines) newCounts.set(l, (newCounts.get(l) ?? 0) + 1);

  let additions = 0;
  for (const [line, count] of newCounts) {
    additions += Math.max(0, count - (oldCounts.get(line) ?? 0));
  }
  let removals = 0;
  for (const [line, count] of oldCounts) {
    removals += Math.max(0, count - (newCounts.get(line) ?? 0));
  }

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

  // Has expandable content if strings are substantial
  const hasExpandableContent = oldString.length > 200 || newString.length > 200;

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
          "flex items-center gap-2",
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

            <div className="ml-5 mt-2 max-h-40 overflow-hidden">
              <MultiFileDiff
                oldFile={{ name: rawFilePath, contents: oldString }}
                newFile={{ name: rawFilePath, contents: newString }}
                options={defaultDiffOptions}
              />
            </div>
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
              {additions} addition{additions !== 1 ? "s" : ""}
            </span>
            <span> and </span>
            <span className="text-red-500">
              {removals} removal{removals !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Full diff view */}
          <div className="max-h-96 overflow-auto">
            <MultiFileDiff
              oldFile={{ name: rawFilePath, contents: oldString }}
              newFile={{ name: rawFilePath, contents: newString }}
              options={defaultDiffOptions}
            />
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
