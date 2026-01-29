import { createNewFileCodeLines } from "@open-harness/shared";
import React, { useMemo } from "react";
import { useChatContext } from "../../chat-context";
import { cliHighlighter } from "../../lib/highlighter";
import type { ToolRendererProps } from "../../lib/render-tool";
import { NewFileLayout, toRelativePath } from "./shared";

export function WriteRenderer({
  part,
  state,
}: ToolRendererProps<"tool-write">) {
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const isInputReady = part.state !== "input-streaming";
  const rawFilePath = isInputReady ? (part.input?.filePath ?? "...") : "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const content = isInputReady ? (part.input?.content ?? "") : "";

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
      lines={
        state.running || state.denied || state.interrupted || outputError
          ? []
          : lines
      }
      totalLines={totalLines}
      hiddenLines={hiddenLines}
      state={mergedState}
    />
  );
}
