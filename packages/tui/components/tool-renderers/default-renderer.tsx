import { getToolName } from "ai";
import React from "react";
import { Text } from "../../ink-shim";
import type { ToolRenderState } from "../../lib/render-tool";
import type { TUIAgentUIToolPart } from "../../types";
import { ToolLayout } from "./shared";

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
      summary={part.input ? JSON.stringify(part.input).slice(0, 40) : "..."}
      output={
        part.state === "output-available" && <Text color="white">Done</Text>
      }
      state={state}
    />
  );
}
