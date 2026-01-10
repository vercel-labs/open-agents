"use client";

import { Loader2 } from "lucide-react";
import {
  type ToolRenderState,
  toRelativePath,
} from "@open-harness/shared/lib/tool-state";
import { createNewFileCodeLines } from "@open-harness/shared/lib/diff";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

type WriteInput = {
  filePath?: string;
  content?: string;
};

type WriteOutput = {
  success?: boolean;
  error?: string;
};

export function WriteRenderer({
  part,
  state,
  cwd,
  onApprove,
  onDeny,
}: {
  part: { input?: unknown; state: string; output?: unknown };
  state: ToolRenderState;
  cwd: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const input = part.input as WriteInput | undefined;
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

  const output =
    part.state === "output-available"
      ? (part.output as WriteOutput)
      : undefined;
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

  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {mergedState.running ? (
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
        <div className="mt-2 pl-5 text-sm text-muted-foreground">Running…</div>
      )}

      {mergedState.approvalRequested &&
        !mergedState.isActiveApproval &&
        mergedState.approvalId && (
          <ApprovalButtons
            approvalId={mergedState.approvalId}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        )}

      {showCode && !mergedState.approvalRequested && !mergedState.denied && (
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
            <div className="mt-2 ml-5 overflow-hidden rounded border border-border bg-muted p-2 font-mono text-xs">
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
    </div>
  );
}
