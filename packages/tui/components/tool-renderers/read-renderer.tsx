import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout, toRelativePath } from "./shared";

export function ReadRenderer({ part, state }: ToolRendererProps<"tool-read">) {
  const cwd = process.cwd();
  const rawFilePath = part.input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const lines =
    part.state === "output-available" ? part.output?.totalLines : undefined;

  return (
    <ToolLayout
      name="Read"
      summary={lines ? `${filePath} (${lines} lines)` : filePath}
      output={lines && <text fg="white">Read {lines} lines</text>}
      state={state}
    />
  );
}
