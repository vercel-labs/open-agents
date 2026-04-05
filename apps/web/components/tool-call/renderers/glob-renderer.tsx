"use client";

import { FolderSearch } from "lucide-react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

type GlobFile = {
  path: string;
};

function getGlobFiles(output: unknown): GlobFile[] {
  if (typeof output !== "object" || output === null) return [];
  if (!("files" in output) || !Array.isArray(output.files)) return [];
  return output.files.filter(
    (file): file is GlobFile =>
      typeof file === "object" &&
      file !== null &&
      "path" in file &&
      typeof file.path === "string",
  );
}

/** Show at most the last 2 path segments */
function truncatePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

export function GlobRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-glob">) {
  const input = part.input;
  const pattern = input?.pattern ?? "...";
  const path = input?.path;

  const output = part.state === "output-available" ? part.output : undefined;
  const files = getGlobFiles(output);

  const summary = path ? `in ${truncatePath(path)}` : "";

  const hasExpandedContent = files.length > 0;

  const expandedContent = hasExpandedContent ? (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
      Found {files.length} file{files.length !== 1 ? "s" : ""}
      {"\n"}
      {files.map((f) => f.path).join("\n")}
    </pre>
  ) : undefined;

  return (
    <ToolLayout
      name="Glob"
      icon={<FolderSearch className="h-3.5 w-3.5" />}
      summary={
        <>
          <span className="font-mono">&apos;{pattern}&apos;</span>
          {summary && (
            <span className="ml-1.5 text-muted-foreground/60">{summary}</span>
          )}
        </>
      }
      meta={files.length > 0 ? `${files.length} files` : undefined}
      state={state}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
