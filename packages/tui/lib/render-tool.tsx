/**
 * Tool rendering with a simple switch statement.
 *
 * This provides type-safe rendering of tool parts without the indirection
 * of a registry pattern. TypeScript's exhaustive checking ensures all
 * tool types are handled.
 */
import React from "react";
import type { TUIAgentUIToolPart } from "../types.js";

// Import all renderers
import { ReadRenderer } from "../components/tool-renderers/read-renderer.js";
import { WriteRenderer } from "../components/tool-renderers/write-renderer.js";
import { EditRenderer } from "../components/tool-renderers/edit-renderer.js";
import { GlobRenderer } from "../components/tool-renderers/glob-renderer.js";
import { GrepRenderer } from "../components/tool-renderers/grep-renderer.js";
import { BashRenderer } from "../components/tool-renderers/bash-renderer.js";
import { TodoRenderer } from "../components/tool-renderers/todo-renderer.js";
import { TaskRenderer } from "../components/tool-renderers/task-renderer.js";
import { DefaultRenderer } from "../components/tool-renderers/default-renderer.js";

/**
 * All possible tool part types derived from the agent.
 */
export type ToolPartType = TUIAgentUIToolPart["type"];

/**
 * Known tool part types (excluding dynamic-tool).
 */
export type KnownToolPartType = Exclude<ToolPartType, "dynamic-tool">;

/**
 * Extract the specific part type for a given tool part type string.
 */
export type ExtractToolPart<T extends ToolPartType> = Extract<
  TUIAgentUIToolPart,
  { type: T }
>;

/**
 * Common state derived from a tool part for renderers.
 */
export type ToolRenderState = {
  /** Whether the tool is currently running */
  running: boolean;
  /** Error message if the tool failed */
  error?: string;
  /** Whether the tool was denied by the user */
  denied: boolean;
  /** Reason for denial if provided */
  denialReason?: string;
  /** Whether approval is being requested */
  approvalRequested: boolean;
  /** Approval ID if approval is requested */
  approvalId?: string;
  /** Whether this is the currently active approval */
  isActiveApproval: boolean;
};

/**
 * Props for a tool renderer component.
 */
export type ToolRendererProps<T extends ToolPartType> = {
  part: ExtractToolPart<T>;
  state: ToolRenderState;
  /** Whether to show expanded details */
  isExpanded?: boolean;
};

/**
 * Extract render state from a tool part.
 */
export function extractRenderState(
  part: TUIAgentUIToolPart,
  activeApprovalId: string | null,
): ToolRenderState {
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const approval = part.approval;
  const denied = part.state === "output-denied" || approval?.approved === false;
  const denialReason = denied ? approval?.reason : undefined;
  const approvalRequested = part.state === "approval-requested" && !denied;
  const error = part.state === "output-error" ? part.errorText : undefined;
  const approvalId = approvalRequested ? approval?.id : undefined;
  const isActiveApproval =
    approvalId != null && approvalId === activeApprovalId;

  return {
    running,
    error,
    denied,
    denialReason,
    approvalRequested,
    approvalId,
    isActiveApproval,
  };
}

/**
 * Render a tool part using a switch statement.
 * TypeScript ensures exhaustive handling of all tool types.
 */
export function renderToolPart(
  part: TUIAgentUIToolPart,
  state: ToolRenderState,
  isExpanded?: boolean,
): React.ReactElement {
  switch (part.type) {
    case "tool-read":
      return <ReadRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "tool-write":
      return (
        <WriteRenderer part={part} state={state} isExpanded={isExpanded} />
      );
    case "tool-edit":
      return <EditRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "tool-glob":
      return <GlobRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "tool-grep":
      return <GrepRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "tool-bash":
      return <BashRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "tool-todo_write":
      return <TodoRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "tool-task":
      return <TaskRenderer part={part} state={state} isExpanded={isExpanded} />;
    case "dynamic-tool":
      return <DefaultRenderer part={part} state={state} />;
  }
}
