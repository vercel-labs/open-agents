import { TextAttributes } from "@opentui/core";
import React from "react";
import { MarkdownContent } from "../lib/markdown";

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
  return (
    <box flexDirection="column">
      {showReasoning && reasoning && (
        <box marginBottom={1} flexDirection="row">
          <text fg="blue" attributes={TextAttributes.DIM}>
            {" "}
            {reasoning}
          </text>
        </box>
      )}
      {text && (
        <box flexDirection="row">
          <text fg="white">● </text>
          <box flexShrink={1} flexGrow={1}>
            <MarkdownContent content={text} />
          </box>
        </box>
      )}
    </box>
  );
}
