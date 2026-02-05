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

  // Show expanded content if there are matches
  const hasExpandedContent = matches.length > 0;

  const expandedContent = hasExpandedContent ? (
    <div className="space-y-3">
      <div className="space-y-1 text-sm">
        <div>
          <span className="text-muted-foreground">Pattern: </span>
          <code className="text-foreground">{pattern}</code>
        </div>
        {path && (
          <div>
            <span className="text-muted-foreground">Path: </span>
            <code className="text-foreground">{path}</code>
          </div>
        )}
        {include && (
          <div>
            <span className="text-muted-foreground">Include: </span>
            <code className="text-foreground">{include}</code>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Matches ({matches.length})
        </div>
        <div className="max-h-64 space-y-1 overflow-auto rounded border border-border bg-muted p-2 font-mono text-xs">
          {matches.map((match, i) => (
            <div key={i} className="text-foreground">
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
      </div>
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Grep"
      summary={`"${pattern}"`}
      state={state}
      output={
        matches.length > 0 ? `Found ${matches.length} matches` : undefined
      }
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
