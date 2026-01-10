"use client";

import type { ToolRenderState } from "@open-harness/shared/lib/tool-state";
import { ToolLayout } from "../tool-layout";

type GrepInput = {
  pattern?: string;
};

type GrepOutput = {
  matches?: unknown[];
};

export function GrepRenderer({
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
  const input = part.input as GrepInput | undefined;
  const pattern = input?.pattern ?? "...";

  const output =
    part.state === "output-available" ? (part.output as GrepOutput) : undefined;
  const matches = output?.matches;

  return (
    <ToolLayout
      name="Grep"
      summary={`"${pattern}"`}
      state={state}
      output={matches ? `Found ${matches.length} matches` : undefined}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
