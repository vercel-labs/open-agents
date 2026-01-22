/**
 * Tool rendering with a simple switch statement.
 *
 * This provides type-safe rendering of tool parts without the indirection
 * of a registry pattern. TypeScript's exhaustive checking ensures all
 * tool types are handled.
 */
import React from "react";
import type { TUIAgentUIToolPart } from "../types";
import {
  extractRenderState,
  type ToolRenderState,
} from "@open-harness/shared/lib/tool-state";

// Import all renderers
import { ReadRenderer } from "../components/tool-renderers/read-renderer";
import { WriteRenderer } from "../components/tool-renderers/write-renderer";
import { EditRenderer } from "../components/tool-renderers/edit-renderer";
import { GlobRenderer } from "../components/tool-renderers/glob-renderer";
import { GrepRenderer } from "../components/tool-renderers/grep-renderer";
import { BashRenderer } from "../components/tool-renderers/bash-renderer";
import { TodoRenderer } from "../components/tool-renderers/todo-renderer";
import { TaskRenderer } from "../components/tool-renderers/task-renderer";
import { AskUserQuestionRenderer } from "../components/tool-renderers/ask-user-question-renderer";
import { DefaultRenderer } from "../components/tool-renderers/default-renderer";

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
 * Props for a tool renderer component.
 */
export type ToolRendererProps<T extends ToolPartType> = {
  part: ExtractToolPart<T>;
  state: ToolRenderState;
  /** Whether to show expanded details */
  isExpanded?: boolean;
};

// Re-export extractRenderState and ToolRenderState for convenience
export { extractRenderState, type ToolRenderState };

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
    case "tool-ask_user_question":
      return (
        <AskUserQuestionRenderer
          part={part}
          state={state}
          isExpanded={isExpanded}
        />
      );
    case "dynamic-tool":
      return <DefaultRenderer part={part} state={state} />;
  }
}
