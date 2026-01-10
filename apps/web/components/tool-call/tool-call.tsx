"use client";

/**
 * Tool call component that renders tool invocations for the web app.
 */
import {
  extractRenderState,
  type ToolRenderState,
  type GenericToolPart,
} from "@open-harness/shared/lib/tool-state";
import { ToolLayout } from "./tool-layout";
import { BashRenderer } from "./renderers/bash-renderer";
import { ReadRenderer } from "./renderers/read-renderer";
import { WriteRenderer } from "./renderers/write-renderer";
import { EditRenderer } from "./renderers/edit-renderer";
import { GlobRenderer } from "./renderers/glob-renderer";
import { GrepRenderer } from "./renderers/grep-renderer";
import { TaskRenderer } from "./renderers/task-renderer";

/**
 * Extended tool part type with toolName for getToolName compatibility.
 */
type ToolPart = GenericToolPart & {
  toolName?: string;
  type?: string;
};

export type ToolCallProps = {
  part: ToolPart;
  activeApprovalId?: string | null;
  cwd?: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
};

/**
 * Get tool name from a tool part.
 * Handles both dynamic-tool and tool-* types.
 */
function getToolNameFromPart(part: ToolPart): string {
  // Dynamic tools have toolName property
  if (part.toolName) {
    return part.toolName;
  }
  // Static tools have type like "tool-read", "tool-bash", etc.
  if (part.type?.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return "unknown";
}

/**
 * Render a tool call based on its type.
 */
export function ToolCall({
  part,
  activeApprovalId = null,
  cwd = "",
  onApprove,
  onDeny,
}: ToolCallProps) {
  const state = extractRenderState(part, activeApprovalId);
  const toolName = getToolNameFromPart(part);
  const approvalProps = { onApprove, onDeny };

  switch (toolName) {
    case "bash":
      return <BashRenderer part={part} state={state} {...approvalProps} />;
    case "read":
      return (
        <ReadRenderer part={part} state={state} cwd={cwd} {...approvalProps} />
      );
    case "write":
      return (
        <WriteRenderer part={part} state={state} cwd={cwd} {...approvalProps} />
      );
    case "edit":
      return (
        <EditRenderer part={part} state={state} cwd={cwd} {...approvalProps} />
      );
    case "glob":
      return <GlobRenderer part={part} state={state} {...approvalProps} />;
    case "grep":
      return <GrepRenderer part={part} state={state} {...approvalProps} />;
    case "task":
      return <TaskRenderer part={part} state={state} {...approvalProps} />;
    default:
      return (
        <DefaultRenderer
          part={part}
          state={state}
          toolName={toolName}
          {...approvalProps}
        />
      );
  }
}

function DefaultRenderer({
  part,
  state,
  toolName,
  onApprove,
  onDeny,
}: {
  part: ToolPart;
  state: ToolRenderState;
  toolName: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  const input = part.input as Record<string, unknown> | undefined;
  const summary = input ? JSON.stringify(input).slice(0, 40) : "...";

  return (
    <ToolLayout
      name={name}
      summary={summary}
      state={state}
      output={part.state === "output-available" ? "Done" : undefined}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}

export { ToolLayout } from "./tool-layout";
export type { ToolRenderState } from "@open-harness/shared";
