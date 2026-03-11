"use client";

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

  const hasExpandedContent = files.length > 0;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-3">
      <div className="space-y-1 text-sm">
        <div>
          <span className="text-muted-foreground">Pattern: </span>
          <code className="text-foreground">{pattern}</code>
        </div>
        {path && (
          <div>
            <span className="text-muted-foreground">Path: </span>
            <code className="text-foreground">{path}</code>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Files ({files.length})
        </div>
        <div className="max-h-64 overflow-auto rounded border border-border bg-muted p-2 font-mono text-xs">
          {files.map((file) => (
            <div key={file.path} className="text-foreground">
              {file?.path}
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Glob"
      summary={`"${pattern}"`}
      summaryClassName="font-mono"
      meta={files.length > 0 ? `${files.length} files` : undefined}
      state={state}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
