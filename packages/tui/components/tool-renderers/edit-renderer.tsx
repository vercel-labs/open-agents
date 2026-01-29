import { createUnifiedDiff, getLanguageFromPath } from "@open-harness/shared";
import React from "react";
import { useChatContext } from "../../chat-context";
import type { ToolRendererProps } from "../../lib/render-tool";
import { FileChangeLayout, toRelativePath } from "./shared";

export function EditRenderer({ part, state }: ToolRendererProps<"tool-edit">) {
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const isInputReady = part.state !== "input-streaming";
  const rawFilePath = isInputReady ? (part.input?.filePath ?? "...") : "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const oldString = isInputReady ? (part.input?.oldString ?? "") : "";
  const newString = isInputReady ? (part.input?.newString ?? "") : "";
  const startLine = Number(part.input?.startLine) || 1;
  const { diff, additions, removals } = createUnifiedDiff(
    oldString,
    newString,
    rawFilePath === "..." ? "file" : rawFilePath,
    startLine,
  );
  const hasChanges = additions + removals > 0;
  const filetype =
    rawFilePath === "..." ? undefined : getLanguageFromPath(rawFilePath);

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
      diff={
        state.running || state.denied || outputError || !hasChanges ? "" : diff
      }
      filetype={filetype}
      state={mergedState}
    />
  );
}
