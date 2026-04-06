"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { FileText } from "lucide-react";
import { File as DiffsFile } from "@pierre/diffs/react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { defaultFileOptions } from "@/lib/diffs-config";
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

  const expandedContent = cleanContent ? (
    isPartialRead && startLine !== undefined ? (
      <div className="max-h-96 overflow-auto rounded-md border border-border bg-[var(--background)] font-mono text-[13px] leading-[20px]">
        <div className="grid grid-cols-[auto_1fr]">
          {cleanContent.split("\n").map((line, i) => {
            const lineNum = startLine + i;
            return (
              <div key={lineNum} className="contents">
                <span className="select-none px-[2ch] text-right text-[color:var(--diffs-fg-number,rgba(255,255,255,0.35))]">
                  {lineNum}
                </span>
                <span className="whitespace-pre overflow-x-auto px-[1ch]">
                  {line}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    ) : (
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <DiffsFile
          file={{ name: rawFilePath, contents: cleanContent }}
          options={defaultFileOptions}
        />
      </div>
    )
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
