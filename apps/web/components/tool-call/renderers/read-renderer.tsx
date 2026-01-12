"use client";

import {
  type ToolRenderState,
  toRelativePath,
} from "@open-harness/shared/lib/tool-state";
import { ToolLayout } from "../tool-layout";

type ReadInput = {
  filePath?: string;
  offset?: number;
  limit?: number;
};

type ReadOutput = {
  success?: boolean;
  error?: string;
  totalLines?: number;
};

export function ReadRenderer({
  part,
  state,
  cwd,
  onApprove,
  onDeny,
}: {
  part: { input?: unknown; state: string; output?: unknown };
  state: ToolRenderState;
  cwd: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const input = part.input as ReadInput | undefined;
  const rawFilePath = input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const offset = input?.offset;
  const limit = input?.limit;

  const output =
    part.state === "output-available" ? (part.output as ReadOutput) : undefined;
  const lines = output?.totalLines;
  const outputError =
    output?.success === false ? (output?.error ?? "Read failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  // Show expanded content if there are additional parameters
  const hasExpandedContent = offset !== undefined || limit !== undefined;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-2 text-sm">
      <div>
        <span className="text-muted-foreground">File: </span>
        <code className="text-foreground">{rawFilePath}</code>
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
      {lines !== undefined && (
        <div>
          <span className="text-muted-foreground">Total lines read: </span>
          <span className="text-foreground">{lines}</span>
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Read"
      summary={lines ? `${filePath} (${lines} lines)` : filePath}
      state={mergedState}
      output={outputError ?? (lines ? `Read ${lines} lines` : undefined)}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
