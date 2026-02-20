"use client";

import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function FetchRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-web_fetch">) {
  const input = part.input;
  const url = input?.url ?? "...";
  const method = input?.method ?? "GET";

  const output = part.state === "output-available" ? part.output : undefined;
  const status = output?.status;
  const outputError =
    output?.success === false ? (output?.error ?? "Fetch failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  // Truncate URL for summary display
  const displayUrl = url.length > 60 ? `${url.slice(0, 57)}...` : url;
  const summary = method === "GET" ? displayUrl : `${method} ${displayUrl}`;

  const hasExpandedContent = method !== "GET" || output?.truncated === true;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-2 text-sm">
      <div>
        <span className="text-muted-foreground">URL: </span>
        <code className="text-foreground break-all">{url}</code>
      </div>
      <div>
        <span className="text-muted-foreground">Method: </span>
        <span className="text-foreground">{method}</span>
      </div>
      {status !== undefined && (
        <div>
          <span className="text-muted-foreground">Status: </span>
          <span className="text-foreground">
            {status} {output?.statusText}
          </span>
        </div>
      )}
      {output?.truncated && (
        <div className="text-yellow-500">Response body was truncated</div>
      )}
    </div>
  ) : undefined;

  const outputText = status
    ? `${status} ${output?.statusText ?? ""}`
    : undefined;

  return (
    <ToolLayout
      name="Fetch"
      summary={summary}
      state={mergedState}
      output={outputError ?? outputText}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
