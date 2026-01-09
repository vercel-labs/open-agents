import React from "react";
import { Text } from "ink";
import type { ToolRendererProps } from "../../lib/render-tool.js";
import { ToolLayout, toRelativePath } from "./shared.js";

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
      output={lines && <Text color="white">Read {lines} lines</Text>}
      state={state}
    />
  );
}
