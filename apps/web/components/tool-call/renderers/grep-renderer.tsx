"use client";

import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

type GrepMatch = {
  file: string;
  line: number;
  content?: string;
};

function getGrepMatches(output: unknown): GrepMatch[] {
  if (typeof output !== "object" || output === null) return [];
  if (!("matches" in output) || !Array.isArray(output.matches)) return [];
  return output.matches.filter(
    (match): match is GrepMatch =>
      typeof match === "object" &&
      match !== null &&
      "file" in match &&
      typeof match.file === "string" &&
      "line" in match &&
      typeof match.line === "number" &&
      (!("content" in match) || typeof match.content === "string"),
  );
}

export function GrepRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-grep">) {
  const input = part.input;
  const pattern = input?.pattern ?? "...";
  const path = input?.path;
  const include = input?.glob;

  const output = part.state === "output-available" ? part.output : undefined;
  const matches = getGrepMatches(output);

  const hasExpandedContent = output !== undefined;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-2">
      <div className="space-y-1 text-sm leading-5">
        <div>
          <span className="text-muted-foreground">Pattern: </span>
          <code className="font-mono text-[13px] text-foreground">
            {pattern}
          </code>
        </div>
        {path && (
          <div>
            <span className="text-muted-foreground">Path: </span>
            <code className="font-mono text-[13px] text-foreground">
              {path}
            </code>
          </div>
        )}
        {include && (
          <div>
            <span className="text-muted-foreground">Include: </span>
            <code className="font-mono text-[13px] text-foreground">
              {include}
            </code>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Matches ({matches.length})
        </div>
        {matches.length > 0 ? (
          <div className="max-h-64 space-y-1 overflow-auto font-mono text-xs leading-5">
            {matches.map((match) => (
              <div
                key={`${match.file}:${match.line}:${match.content ?? ""}`}
                className="text-foreground"
              >
                <span className="text-muted-foreground">{match.file}</span>
                <span className="text-yellow-500">:{match.line}</span>
                {match.content && (
                  <span className="ml-2 text-foreground">
                    {match.content.slice(0, 100)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No matches</div>
        )}
      </div>
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Grep"
      summary={`"${pattern}"`}
      summaryClassName="font-mono"
      meta={output ? `${matches.length} matches` : undefined}
      state={state}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
