"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { MultiFileDiff } from "@pierre/diffs/react";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
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

  // Count additions and removals using multiset comparison to handle duplicate lines
  const { additions, removals } = useMemo(() => {
    const oldLines = oldString.split("\n");
    const newLines = newString.split("\n");

    const oldCounts = new Map<string, number>();
    for (const l of oldLines) oldCounts.set(l, (oldCounts.get(l) ?? 0) + 1);
    const newCounts = new Map<string, number>();
    for (const l of newLines) newCounts.set(l, (newCounts.get(l) ?? 0) + 1);

    let add = 0;
    for (const [line, count] of newCounts) {
      add += Math.max(0, count - (oldCounts.get(line) ?? 0));
    }
    let rem = 0;
    for (const [line, count] of oldCounts) {
      rem += Math.max(0, count - (newCounts.get(line) ?? 0));
    }
    return { additions: add, removals: rem };
  }, [oldString, newString]);

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

  // Keep rich diff rendering opt-in to avoid expensive inline diffs in long chats.
  const hasExpandableContent = showDiff && !mergedState.denied;

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

      {/* Collapsed summary */}
      {!isExpanded && showDiff && !mergedState.denied && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">
          <span className="text-green-500">+{additions}</span>
          <span className="mx-1 text-red-500">-{removals}</span>
        </div>
      )}

      {/* Expanded full diff */}
      {isExpanded && showDiff && !mergedState.denied && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-2 text-sm text-muted-foreground">
            <span className="text-green-500">+{additions}</span>
            <span className="mx-1 text-red-500">-{removals}</span>
          </div>

          <div className="max-h-96 overflow-auto">
            <MultiFileDiff
              oldFile={{ name: rawFilePath, contents: oldString }}
              newFile={{ name: rawFilePath, contents: newString }}
              options={defaultDiffOptions}
            />
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
