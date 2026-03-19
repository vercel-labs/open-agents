"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

function getLastOutputLine(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.at(-1);
}

export function BashRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-bash">) {
  const input = part.input;
  const command = String(input?.command ?? "");
  const cwd = input?.cwd;
  const isDetached = input?.detached === true;

  const output = part.state === "output-available" ? part.output : undefined;
  const exitCode = output?.exitCode;
  const stdout = output?.stdout;
  const stderr = output?.stderr;
  const hasOutput = Boolean(stdout || stderr);
  const toolFailed = output?.success === false;
  const isError =
    toolFailed || (typeof exitCode === "number" && exitCode !== 0);

  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
  const lastOutputLine = combinedOutput
    ? getLastOutputLine(combinedOutput)
    : undefined;
  const hasExpandableContent =
    part.state === "output-available" || Boolean(cwd) || isDetached;

  const indicator = state.interrupted ? (
    <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
  ) : state.running ? (
    <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
  ) : (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        state.denied
          ? "bg-red-500"
          : state.approvalRequested
            ? "bg-yellow-500"
            : isError
              ? "bg-red-500"
              : "bg-green-500",
      )}
    />
  );

  const meta =
    lastOutputLine || isDetached ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {lastOutputLine && (
          <span
            className={cn(
              "max-w-56 truncate font-mono text-[12px] sm:max-w-72",
              isError && "text-red-600/80 dark:text-red-400/90",
            )}
          >
            {lastOutputLine}
          </span>
        )}
        {isDetached && (
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-medium text-blue-500">
            detached
          </span>
        )}
      </span>
    ) : undefined;

  const expandedContent = hasExpandableContent ? (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Command
        </div>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
          {command || "..."}
        </pre>
      </div>

      {cwd && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Working Directory
          </div>
          <code className="text-sm text-foreground">{cwd}</code>
        </div>
      )}

      {isDetached && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Mode
          </div>
          <span className="text-sm text-foreground">Detached (background)</span>
        </div>
      )}

      {part.state === "output-available" && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>Output</span>
            {typeof exitCode === "number" && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  isError
                    ? "bg-red-500/20 text-red-500"
                    : "bg-green-500/20 text-green-500",
                )}
              >
                exit {exitCode}
              </span>
            )}
          </div>
          {hasOutput ? (
            <pre
              className={cn(
                "max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs",
                isError ? "text-red-400" : "text-foreground",
              )}
            >
              {combinedOutput}
            </pre>
          ) : (
            <div className="text-sm text-muted-foreground">(No output)</div>
          )}
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Bash"
      summary={command || "..."}
      summaryClassName="font-mono"
      meta={meta}
      state={state}
      indicator={indicator}
      nameClassName={isError ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
