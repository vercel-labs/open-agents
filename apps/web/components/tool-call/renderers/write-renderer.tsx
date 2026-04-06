"use client";

import { toRelativePath } from "@open-harness/shared/lib/tool-state";
import { FilePlus } from "lucide-react";
import { File as DiffsFile } from "@pierre/diffs/react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { defaultFileOptions } from "@/lib/diffs-config";
import { ToolLayout } from "../tool-layout";
import { FileNamePill } from "../file-name-pill";

const wrappedFileExtensions = new Set([".md", ".mdx", ".markdown", ".txt"]);

function shouldWrapFileContent(filePath: string) {
  const normalizedPath = filePath.toLowerCase();
  return [...wrappedFileExtensions].some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

export function WriteRenderer({
  part,
  state,
  cwd = "",
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-write">) {
  const input = part.input;
  const rawFilePath = input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const content = input?.content ?? "";

  const totalLines = content.length === 0 ? 0 : content.split("\n").length;
  const fileOptions = shouldWrapFileContent(rawFilePath)
    ? { ...defaultFileOptions, overflow: "wrap" as const }
    : defaultFileOptions;

  const output = part.state === "output-available" ? part.output : undefined;
  const outputError =
    output?.success === false ? (output?.error ?? "Write failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const showCode =
    mergedState.approvalRequested ||
    (!mergedState.running && !mergedState.error && !mergedState.denied);

  const expandedContent =
    showCode && !mergedState.denied ? (
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <DiffsFile
          file={{ name: rawFilePath, contents: content }}
          options={fileOptions}
        />
      </div>
    ) : undefined;

  const meta =
    showCode && !mergedState.denied ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-green-500">+{totalLines}</span>
        <span className="text-red-500">-0</span>
      </span>
    ) : undefined;

  return (
    <ToolLayout
      name="Create"
      icon={<FilePlus className="h-3.5 w-3.5" />}
      summary={
        filePath === "..." ? (
          filePath
        ) : (
          <FileNamePill
            filePath={filePath}
            fullPath={rawFilePath}
            error={Boolean(mergedState.error)}
          />
        )
      }
      meta={meta}
      errorMeta={mergedState.error ? "failed" : undefined}
      state={mergedState}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
