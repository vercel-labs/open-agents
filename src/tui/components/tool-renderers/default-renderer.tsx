import React from "react";
import { Text } from "ink";
import { getToolName } from "ai";
import type { TUIAgentUIToolPart } from "../../types.js";
import type { ToolRenderState } from "../../lib/render-tool.js";
import { ToolLayout } from "./shared.js";

/**
 * Default renderer for unknown tool types.
 * Used as a fallback when no specific renderer is registered.
 */
export function DefaultRenderer({
  part,
  state,
}: {
  part: TUIAgentUIToolPart;
  state: ToolRenderState;
}) {
  const toolName = getToolName(part);
  const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);

  return (
    <ToolLayout
      name={name}
      summary={JSON.stringify(part.input).slice(0, 40)}
      output={
        part.state === "output-available" && <Text color="white">Done</Text>
      }
      state={state}
    />
  );
}
