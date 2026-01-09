/**
 * Tool call component that renders tool invocations.
 *
 * This component serves as the entry point for rendering any tool call.
 * It extracts the render state and delegates to the appropriate renderer.
 */
import React from "react";
import type { TUIAgentUIToolPart } from "../types.js";
import { renderToolPart, extractRenderState } from "../lib/render-tool.js";

// Re-export approval utilities for backwards compatibility
export { getToolApprovalInfo, inferApprovalRule } from "../lib/approval.js";
export type { ToolApprovalInfo } from "../lib/approval.js";

// Re-export shared components for backwards compatibility
export { ToolSpinner, SubagentToolCall } from "./tool-renderers/index.js";

// Re-export ApprovalButtons (keeping it here for now as it's tightly coupled to chat context)
export { ApprovalButtons } from "./approval-buttons.js";

export type ToolCallProps = {
  part: TUIAgentUIToolPart;
  activeApprovalId: string | null;
  isExpanded?: boolean;
};

/**
 * Render a tool call.
 *
 * This is the main entry point for rendering tool invocations in the TUI.
 * It extracts the render state and delegates to the appropriate renderer.
 */
export function ToolCall({
  part,
  activeApprovalId,
  isExpanded = false,
}: ToolCallProps) {
  const state = extractRenderState(part, activeApprovalId);

  return renderToolPart(part, state, isExpanded);
}
