import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout } from "./shared";

export function GlobRenderer({ part, state }: ToolRendererProps<"tool-glob">) {
  const isInputReady = part.state !== "input-streaming";
  const pattern = isInputReady ? (part.input?.pattern ?? "...") : "...";
  const files =
    part.state === "output-available" ? part.output?.files : undefined;

  return (
    <ToolLayout
      name="Glob"
      summary={`"${pattern}"`}
      output={files && <text fg="white">Found {files.length} files</text>}
      state={state}
    />
  );
}
