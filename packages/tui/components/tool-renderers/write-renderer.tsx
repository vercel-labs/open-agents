import React, { useMemo } from "react";
import { createNewFileCodeLines } from "@open-harness/shared";
import type { ToolRendererProps } from "../../lib/render-tool";
import { NewFileLayout, toRelativePath } from "./shared";
import { useChatContext } from "../../chat-context";
import { cliHighlighter } from "../../lib/highlighter";

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

  // Memoize the expensive syntax highlighting operation
  const { lines, totalLines, hiddenLines } = useMemo(
    () => createNewFileCodeLines(content, rawFilePath, cliHighlighter),
    [content, rawFilePath],
  );

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
    <NewFileLayout
      filePath={filePath}
      lines={state.running || state.denied || outputError ? [] : lines}
      totalLines={totalLines}
      hiddenLines={hiddenLines}
      state={mergedState}
    />
  );
}
