/**
 * Tool rendering with a simple switch statement.
 *
 * This provides type-safe rendering of tool parts without the indirection
 * of a registry pattern. TypeScript's exhaustive checking ensures all
 * tool types are handled.
 */
import type { WebAgentUIToolPart } from "../types";
import {
  extractRenderState,
  type ToolRenderState,
} from "@open-harness/shared/lib/tool-state";

/**
 * All possible tool part types derived from the agent.
 */
export type ToolPartType = WebAgentUIToolPart["type"];

/**
 * Known tool part types (excluding dynamic-tool).
 */
export type KnownToolPartType = Exclude<ToolPartType, "dynamic-tool">;

/**
 * Extract the specific part type for a given tool part type string.
 */
export type ExtractToolPart<T extends ToolPartType> = Extract<
  WebAgentUIToolPart,
  { type: T }
>;

/**
 * Props for a tool renderer component.
 */
export type ToolRendererProps<T extends ToolPartType> = {
  part: ExtractToolPart<T>;
  state: ToolRenderState;
  cwd?: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
};

/**
 * Get tool name from a tool part type.
 * Handles both dynamic-tool and tool-* types.
 */
export function getToolName(part: WebAgentUIToolPart): string {
  if (part.type === "dynamic-tool") {
    return part.toolName;
  }
  // Static tools have type like "tool-read", "tool-bash", etc.
  return part.type.slice(5);
}

// Re-export extractRenderState for convenience
export { extractRenderState, type ToolRenderState };
