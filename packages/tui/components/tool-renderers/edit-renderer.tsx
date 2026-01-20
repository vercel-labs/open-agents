import React from "react";
import { createEditDiffLines } from "@open-harness/shared";
import type { ToolRendererProps } from "../../lib/render-tool";
import { FileChangeLayout, toRelativePath } from "./shared";
import { useChatContext } from "../../chat-context";

export function EditRenderer({ part, state }: ToolRendererProps<"tool-edit">) {
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const rawFilePath = part.input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const oldString = part.input?.oldString ?? "";
  const newString = part.input?.newString ?? "";
  const { lines, additions, removals } = createEditDiffLines(
    oldString,
    newString,
  );

  // Check for tool execution failure (success: false in output)
  const outputError =
    part.state === "output-available" && part.output?.success === false
      ? (part.output?.error ?? "Edit failed")
      : undefined;

  // Merge output error into state
  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  return (
    <FileChangeLayout
      action="Update"
      filePath={filePath}
      additions={additions}
      removals={removals}
      lines={state.running || state.denied || outputError ? [] : lines}
      state={mergedState}
    />
  );
}
