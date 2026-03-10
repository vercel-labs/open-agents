"use client";

import type { ReactNode } from "react";
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

  const displayUrl = url.length > 60 ? `${url.slice(0, 57)}...` : url;
  const summary = method === "GET" ? displayUrl : `${method} ${displayUrl}`;

  const hasExpandedContent = method !== "GET" || output?.truncated === true;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-2 text-sm">
      <div>
        <span className="text-muted-foreground">URL: </span>
        <code className="break-all text-foreground">{url}</code>
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

  const meta: ReactNode =
    status !== undefined || output?.truncated ? (
      <span className="inline-flex items-center gap-1.5">
        {status !== undefined && (
          <span>
            {status}
            {output?.statusText ? ` ${output.statusText}` : ""}
          </span>
        )}
        {output?.truncated && (
          <span className="text-yellow-500">truncated</span>
        )}
      </span>
    ) : undefined;

  return (
    <ToolLayout
      name="Fetch"
      summary={summary}
      summaryClassName="font-mono"
      meta={meta}
      state={mergedState}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
