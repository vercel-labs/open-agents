import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout } from "./shared";

function getMatchCount(output: unknown): number | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  if (!("matches" in output) || !Array.isArray(output.matches))
    return undefined;
  return output.matches.length;
}

export function GrepRenderer({ part, state }: ToolRendererProps<"tool-grep">) {
  const isInputReady = part.state !== "input-streaming";
  const pattern = isInputReady ? (part.input?.pattern ?? "...") : "...";
  const matchCount =
    part.state === "output-available" ? getMatchCount(part.output) : undefined;

  return (
    <ToolLayout
      name="Grep"
      summary={`"${pattern}"`}
      output={
        matchCount !== undefined && (
          <text fg="white">Found {matchCount} matches</text>
        )
      }
      state={state}
    />
  );
}
