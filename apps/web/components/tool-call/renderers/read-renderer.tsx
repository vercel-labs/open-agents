"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { FileText } from "lucide-react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";
import { FileNamePill } from "../file-name-pill";

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
  const fileContent = output?.content;
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

  // Always show expanded content if we have file content
  const hasExpandedContent =
    fileContent !== undefined || offset !== undefined || limit !== undefined;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-2">
      {(offset !== undefined || limit !== undefined) && (
        <div className="space-y-1 text-sm">
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
        </div>
      )}
      {fileContent && (
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
          {fileContent}
        </pre>
      )}
    </div>
  ) : undefined;

  const meta = isPartialRead
    ? `[${startLine}–${endLine}]`
    : totalLines !== undefined
      ? `${totalLines} lines`
      : undefined;

  return (
    <ToolLayout
      name="Read"
      icon={<FileText className="h-3.5 w-3.5" />}
      summary={
        filePath === "..." ? (
          filePath
        ) : (
          <FileNamePill filePath={filePath} fullPath={rawFilePath} />
        )
      }
      meta={meta}
      state={mergedState}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
