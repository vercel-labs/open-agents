import React from "react";
import type { ToolRendererProps } from "../../lib/render-tool";
import { ToolLayout } from "./shared";

export function FetchRenderer({
  part,
  state,
}: ToolRendererProps<"tool-web_fetch">) {
  const isInputReady = part.state !== "input-streaming";
  const url = isInputReady ? (part.input?.url ?? "...") : "...";
  const method = isInputReady ? (part.input?.method ?? "GET") : "GET";

  const output = part.state === "output-available" ? part.output : undefined;
  const status = output?.status;
  const statusText = output?.statusText;

  const displayUrl = url.length > 50 ? `${url.slice(0, 47)}...` : url;
  const summary = method === "GET" ? displayUrl : `${method} ${displayUrl}`;

  const outputNode = status !== undefined && (
    <text fg="white">
      {status} {statusText}
    </text>
  );

  return (
    <ToolLayout
      name="Fetch"
      summary={summary}
      output={outputNode}
      state={state}
    />
  );
}
