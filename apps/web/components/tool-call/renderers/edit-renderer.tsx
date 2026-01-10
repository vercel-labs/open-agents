"use client";

import { Loader2 } from "lucide-react";
import {
  type ToolRenderState,
  toRelativePath,
} from "@open-harness/shared/lib/tool-state";
import { createEditDiffLines } from "@open-harness/shared/lib/diff";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

type EditInput = {
  filePath?: string;
  oldString?: string;
  newString?: string;
};

type EditOutput = {
  success?: boolean;
  error?: string;
};

export function EditRenderer({
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
  const input = part.input as EditInput | undefined;
  const rawFilePath = input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const oldString = input?.oldString ?? "";
  const newString = input?.newString ?? "";

  const { lines, additions, removals } = createEditDiffLines(
    oldString,
    newString,
    1,
    10,
  );

  const output =
    part.state === "output-available" ? (part.output as EditOutput) : undefined;
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

  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {mergedState.running ? (
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

      {showDiff && !mergedState.approvalRequested && !mergedState.denied && (
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
            <div className="mt-2 ml-5 overflow-hidden rounded border border-border bg-muted font-mono text-xs">
              {lines.map((line, i) => (
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
                        {line.content.slice(0, 80)}
                      </span>
                    </>
                  )}
                </div>
              ))}
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
