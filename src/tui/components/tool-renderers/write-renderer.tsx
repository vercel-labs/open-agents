import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool.js";
import { createWriteDiffLines } from "../../lib/diff.js";
import { FileChangeLayout, toRelativePath } from "./shared.js";
import { useChatContext } from "../../chat-context.js";

export function WriteRenderer({
  part,
  state,
}: ToolRendererProps<"tool-write">) {
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const rawFilePath = part.input?.filePath ?? "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const content = part.input?.content ?? "";
  const lines = createWriteDiffLines(content);
  const additions = content ? content.split("\n").length : 0;

  // Check for tool execution failure (success: false in output)
  const outputError =
    part.state === "output-available" && part.output?.success === false
      ? (part.output?.error ?? "Write failed")
      : undefined;

  // Merge output error into state
  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  return (
    <FileChangeLayout
      action="Create"
      filePath={filePath}
      additions={additions}
      removals={0}
      lines={state.running || state.denied || outputError ? [] : lines}
      state={mergedState}
    />
  );
}
