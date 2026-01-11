"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { ToolLayout } from "../tool-layout";

type GlobInput = {
  pattern?: string;
  path?: string;
};

type GlobOutput = {
  files?: string[];
};

export function GlobRenderer({
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
  const input = part.input as GlobInput | undefined;
  const pattern = input?.pattern ?? "...";
  const path = input?.path;

  const output =
    part.state === "output-available" ? (part.output as GlobOutput) : undefined;
  const files = output?.files ?? [];

  // Show expanded content if there are files to show
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
          {files.map((file, i) => (
            <div key={i} className="text-foreground">
              {file}
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
      state={state}
      output={files.length > 0 ? `Found ${files.length} files` : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
