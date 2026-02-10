import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import React from "react";
import { MarkdownContent } from "../lib/markdown";
import { wrapMarkdown } from "../lib/wrap-markdown";

function prefixLines(
  content: string,
  firstPrefix: string,
  restPrefix: string,
): string {
  const lines = content.split("\n");
  return lines
    .map((line, index) => `${index === 0 ? firstPrefix : restPrefix}${line}`)
    .join("\n");
}

type TextOutputProps = {
  text: string;
  reasoning?: string;
  showReasoning?: boolean;
};

export function TextOutput({
  text,
  reasoning,
  showReasoning = false,
}: TextOutputProps) {
  const { width } = useTerminalDimensions();
  const terminalWidth = width ?? 80;
  const bulletWidth = 2;
  const linePrefix = "└ ";
  const lineContinuation = "  ";
  const maxContentWidth = Math.max(
    10,
    terminalWidth - bulletWidth - linePrefix.length,
  );
  const wrappedText = prefixLines(
    wrapMarkdown(text, maxContentWidth),
    linePrefix,
    lineContinuation,
  );
  const wrappedReasoning = reasoning
    ? prefixLines(
        wrapMarkdown(reasoning, maxContentWidth),
        linePrefix,
        lineContinuation,
      )
    : reasoning;

  return (
    <box flexDirection="column">
      {showReasoning && wrappedReasoning && (
        <box marginBottom={1} flexDirection="row">
          <text fg="blue" attributes={TextAttributes.DIM}>
            {" "}
          </text>
          <box flexShrink={1} flexGrow={1}>
            <text fg="blue" attributes={TextAttributes.DIM}>
              {wrappedReasoning}
            </text>
          </box>
        </box>
      )}
      {wrappedText && (
        <box flexDirection="row">
          <text fg="white">● </text>
          <box flexShrink={1} flexGrow={1}>
            <MarkdownContent content={wrappedText} />
          </box>
        </box>
      )}
    </box>
  );
}
