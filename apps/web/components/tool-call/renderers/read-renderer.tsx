"use client";

import {
  type ToolRenderState,
  toRelativePath,
} from "@open-harness/shared/lib/tool-state";
import { ToolLayout } from "../tool-layout";

type ReadInput = {
  filePath?: string;
};

type ReadOutput = {
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

  const output =
    part.state === "output-available" ? (part.output as ReadOutput) : undefined;
  const lines = output?.totalLines;

  return (
    <ToolLayout
      name="Read"
      summary={lines ? `${filePath} (${lines} lines)` : filePath}
      state={state}
      output={lines ? `Read ${lines} lines` : undefined}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
