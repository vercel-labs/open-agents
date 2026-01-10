"use client";

import { Loader2 } from "lucide-react";
import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { cn } from "@/lib/utils";
import { ApprovalButtons } from "../approval-buttons";

type BashInput = {
  command?: string;
};

type BashOutput = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
};

export function BashRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: {
  part: { input?: unknown; state: string; output?: unknown };
  state: ToolRenderState;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const input = part.input as BashInput | undefined;
  const command = String(input?.command ?? "");

  const output =
    part.state === "output-available" ? (part.output as BashOutput) : undefined;
  const exitCode = output?.exitCode;
  const stdout = output?.stdout;
  const stderr = output?.stderr;
  const hasOutput = stdout || stderr;
  const isError = exitCode !== undefined && exitCode !== 0;

  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
  const allLines = combinedOutput.split("\n");
  const outputLines = allLines.slice(-3);
  const hasMoreLines = allLines.length > 3;

  const dotColor = state.denied
    ? "bg-red-500"
    : state.approvalRequested
      ? "bg-yellow-500"
      : isError
        ? "bg-red-500"
        : state.running
          ? "bg-yellow-500"
          : "bg-green-500";

  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {state.running ? (
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
        ) : (
          <span className={cn("inline-block h-2 w-2 rounded-full", dotColor)} />
        )}
        <span
          className={cn(
            "font-medium",
            state.denied ? "text-red-500" : "text-foreground",
          )}
        >
          Bash
        </span>
        <span className="text-muted-foreground">(</span>
        <code className="max-w-md truncate rounded bg-muted px-1 text-sm">
          {command.length > 60 ? command.slice(0, 60) + "…" : command || "..."}
        </code>
        <span className="text-muted-foreground">)</span>
      </div>

      {state.approvalRequested && state.isActiveApproval && (
        <div className="mt-2 pl-5 text-sm text-muted-foreground">Running…</div>
      )}

      {state.approvalRequested &&
        !state.isActiveApproval &&
        state.approvalId && (
          <ApprovalButtons
            approvalId={state.approvalId}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        )}

      {part.state === "output-available" &&
        !state.approvalRequested &&
        !state.denied && (
          <div className="mt-2 pl-5">
            {isError && (
              <div className="text-sm text-red-500">
                Error: Exit code {exitCode}
              </div>
            )}
            {hasOutput ? (
              <div className="mt-1 rounded bg-muted p-2 font-mono text-xs">
                {hasMoreLines && (
                  <div className="text-muted-foreground">...</div>
                )}
                {outputLines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "truncate",
                      isError ? "text-red-400" : "text-foreground",
                    )}
                  >
                    {line.slice(0, 100)}
                  </div>
                ))}
              </div>
            ) : (
              !isError && (
                <div className="text-sm text-muted-foreground">(No output)</div>
              )
            )}
          </div>
        )}

      {state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Denied{state.denialReason ? `: ${state.denialReason}` : ""}
        </div>
      )}

      {state.error && !state.denied && (
        <div className="mt-2 pl-5 text-sm text-red-500">
          Error: {state.error.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
