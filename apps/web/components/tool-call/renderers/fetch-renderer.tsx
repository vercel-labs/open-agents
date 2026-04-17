"use client";

import { Globe } from "lucide-react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

type FetchSuccessOutput = {
  success: true;
  status: number | null;
  body: string;
  contentType?: string | null;
  bytes?: number;
  truncated?: boolean;
  savedBodyPath?: string | null;
};

function isFetchSuccessOutput(output: unknown): output is FetchSuccessOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "success" in output &&
    output.success === true &&
    "body" in output &&
    typeof output.body === "string"
  );
}

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
  const successOutput = isFetchSuccessOutput(output) ? output : undefined;
  const status = successOutput?.status;
  const outputError =
    output?.success === false ? (output.error ?? "Fetch failed") : undefined;

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  const displayUrl = url.length > 60 ? `${url.slice(0, 57)}...` : url;
  const summary = method === "GET" ? displayUrl : `${method} ${displayUrl}`;

  const meta = [
    status,
    successOutput && typeof successOutput.bytes === "number"
      ? `${successOutput.bytes}B`
      : null,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" · ");

  const expandedContent = successOutput ? (
    <div className="space-y-2">
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div>{successOutput.contentType ?? "unknown content type"}</div>
        {successOutput.savedBodyPath && (
          <div className="mt-1 font-mono text-[11px] text-foreground/80">
            Saved full body: {successOutput.savedBodyPath}
          </div>
        )}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
        {successOutput.body || "(empty body)"}
      </pre>
      {successOutput.truncated && !successOutput.savedBodyPath && (
        <div className="text-xs text-muted-foreground">
          Preview truncated to the inline fetch limit.
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Fetch"
      icon={<Globe className="h-3.5 w-3.5" />}
      summary={summary}
      summaryClassName="font-mono"
      meta={meta || undefined}
      state={mergedState}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
