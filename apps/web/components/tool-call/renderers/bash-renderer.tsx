"use client";

import { Terminal } from "lucide-react";
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
    <pre
      className={cn(
        "max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed",
        isError ? "text-red-400" : "text-muted-foreground",
      )}
    >
      {hasOutput ? combinedOutput : "(No output)"}
    </pre>
  ) : undefined;

  return (
    <ToolLayout
      name="Bash"
      summary={command || "..."}
      summaryClassName="font-mono"
      meta={meta}
      state={state}
      icon={<Terminal className="h-3.5 w-3.5" />}
      nameClassName={isError ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
