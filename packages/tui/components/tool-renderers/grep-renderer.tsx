import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout } from "./shared";

export function GrepRenderer({ part, state }: ToolRendererProps<"tool-grep">) {
  const isInputReady = part.state !== "input-streaming";
  const pattern = isInputReady ? (part.input?.pattern ?? "...") : "...";
  const matches =
    part.state === "output-available" ? part.output?.matches : undefined;

  return (
    <ToolLayout
      name="Grep"
      summary={`"${pattern}"`}
      output={matches && <text fg="white">Found {matches.length} matches</text>}
      state={state}
    />
  );
}
