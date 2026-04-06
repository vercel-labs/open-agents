"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { FileText } from "lucide-react";
import { File as DiffsFile } from "@pierre/diffs/react";
import { useMemo } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { defaultFileOptions } from "@/lib/diffs-config";
import type { BaseCodeOptions } from "@pierre/diffs/react";
import { ToolLayout } from "../tool-layout";
import { FileNamePill } from "../file-name-pill";

/**
 * Build file options that override line numbers via CSS counters
 * so a partial read starting at e.g. line 87 shows "87" instead of "1".
 */
function makeOffsetFileOptions(offset: number): BaseCodeOptions {
  const counterCSS = `
    :host [data-code] {
      counter-reset: line-number ${offset};
    }
    :host [data-column-number] [data-line-number-content] {
      visibility: hidden;
      position: relative;
    }
    :host [data-column-number] [data-line-number-content]::after {
      visibility: visible;
      position: absolute;
      right: 0;
      counter-increment: line-number;
      content: counter(line-number);
    }
  `;
  return {
    ...defaultFileOptions,
    unsafeCSS: (defaultFileOptions.unsafeCSS ?? "") + counterCSS,
  };
}

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

  // Strip line number prefixes ("N: ") from content for the code viewer
  const cleanContent = fileContent
    ? fileContent
        .split("\n")
        .map((line) => line.replace(/^\d+: /, ""))
        .join("\n")
    : undefined;

  const fileOptions = useMemo(
    () =>
      isPartialRead && startLine !== undefined && startLine > 1
        ? makeOffsetFileOptions(startLine - 1)
        : defaultFileOptions,
    [isPartialRead, startLine],
  );

  const expandedContent = cleanContent ? (
    <div className="max-h-96 overflow-auto rounded-md border border-border">
      <DiffsFile
        file={{ name: rawFilePath, contents: cleanContent }}
        options={fileOptions}
      />
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
