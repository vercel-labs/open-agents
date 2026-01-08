import React from "react";
import { Text } from "ink";
import type { ToolRendererProps } from "../../lib/render-tool.js";
import { ToolLayout } from "./shared.js";

export function GlobRenderer({ part, state }: ToolRendererProps<"tool-glob">) {
  const pattern = part.input?.pattern ?? "...";
  const files =
    part.state === "output-available" ? part.output?.files : undefined;

  return (
    <ToolLayout
      name="Glob"
      summary={`"${pattern}"`}
      output={files && <Text color="white">Found {files.length} files</Text>}
      state={state}
    />
  );
}
