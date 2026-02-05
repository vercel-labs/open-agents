import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout } from "./shared";

function getFileCount(output: unknown): number | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  if (!("files" in output) || !Array.isArray(output.files)) return undefined;
  return output.files.length;
}

export function GlobRenderer({ part, state }: ToolRendererProps<"tool-glob">) {
  const isInputReady = part.state !== "input-streaming";
  const pattern = isInputReady ? (part.input?.pattern ?? "...") : "...";
  const fileCount =
    part.state === "output-available" ? getFileCount(part.output) : undefined;

  return (
    <ToolLayout
      name="Glob"
      summary={`"${pattern}"`}
      output={
        fileCount !== undefined && (
          <text fg="white">Found {fileCount} files</text>
        )
      }
      state={state}
    />
  );
}
