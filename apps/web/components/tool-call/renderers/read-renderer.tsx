"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function ReadRenderer({
  part,
  state,
  cwd = "",
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-read">) {
  const input = part.input;
  const rawFilePath = input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const offset = input?.offset;
  const limit = input?.limit;

  const output = part.state === "output-available" ? part.output : undefined;
  const totalLines = output?.totalLines;
  const startLine = output?.startLine;
  const endLine = output?.endLine;
  const isPartialRead =
    startLine !== undefined &&
    endLine !== undefined &&
    totalLines !== undefined &&
    (startLine > 1 || endLine < totalLines);
  const outputError =
    output?.success === false ? (output?.error ?? "Read failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const hasExpandedContent = offset !== undefined || limit !== undefined;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-2 text-sm">
      <div>
        <span className="text-muted-foreground">File: </span>
        <code className="text-foreground">{filePath}</code>
      </div>
      {offset !== undefined && (
        <div>
          <span className="text-muted-foreground">Offset: </span>
          <span className="text-foreground">line {offset}</span>
        </div>
      )}
      {limit !== undefined && (
        <div>
          <span className="text-muted-foreground">Limit: </span>
          <span className="text-foreground">{limit} lines</span>
        </div>
      )}
      {totalLines !== undefined && (
        <div>
          <span className="text-muted-foreground">Total lines: </span>
          <span className="text-foreground">{totalLines}</span>
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Read"
      summary={filePath}
      summaryClassName="font-mono"
      meta={
        isPartialRead
          ? `[${startLine}–${endLine}]`
          : totalLines !== undefined
            ? `${totalLines} lines`
            : undefined
      }
      state={mergedState}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
