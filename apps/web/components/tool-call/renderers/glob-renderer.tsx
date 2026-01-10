"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { ToolLayout } from "../tool-layout";

type GlobInput = {
  pattern?: string;
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

  const output =
    part.state === "output-available" ? (part.output as GlobOutput) : undefined;
  const files = output?.files;

  return (
    <ToolLayout
      name="Glob"
      summary={`"${pattern}"`}
      state={state}
      output={files ? `Found ${files.length} files` : undefined}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
