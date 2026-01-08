import React from "react";
import { Text } from "ink";
import type { ToolRendererProps } from "../../lib/render-tool.js";
import { ToolLayout } from "./shared.js";

export function GrepRenderer({ part, state }: ToolRendererProps<"tool-grep">) {
  const pattern = part.input?.pattern ?? "...";
  const matches =
    part.state === "output-available" ? part.output?.matches : undefined;

  return (
    <ToolLayout
      name="Grep"
      summary={`"${pattern}"`}
      output={
        matches && <Text color="white">Found {matches.length} matches</Text>
      }
      state={state}
    />
  );
}
