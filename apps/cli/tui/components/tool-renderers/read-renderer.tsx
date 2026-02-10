import React from "react";
import { useChatContext } from "../../chat-context";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout, toRelativePath } from "./shared";

export function ReadRenderer({ part, state }: ToolRendererProps<"tool-read">) {
  const { state: chatState } = useChatContext();
  const cwd = chatState.workingDirectory ?? process.cwd();
  const isInputReady = part.state !== "input-streaming";
  const rawFilePath = isInputReady ? (part.input?.filePath ?? "...") : "...";
  const filePath =
    rawFilePath === "..." ? rawFilePath : toRelativePath(rawFilePath, cwd);
  const lines =
    part.state === "output-available" ? part.output?.totalLines : undefined;

  return (
    <ToolLayout
      name="Read"
      summary={filePath}
      output={lines && <text fg="white">Read {lines} lines</text>}
      state={state}
    />
  );
}
