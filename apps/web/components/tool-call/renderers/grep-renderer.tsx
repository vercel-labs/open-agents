"use client";

import { Search } from "lucide-react";
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

/** Show at most the last 2 path segments */
function truncatePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

/** Deduplicate file paths from matches */
function getUniqueFiles(matches: GrepMatch[]): string[] {
  const seen = new Set<string>();
  for (const m of matches) {
    seen.add(m.file);
  }
  return Array.from(seen);
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

  const output = part.state === "output-available" ? part.output : undefined;
  const matches = getGrepMatches(output);
  const uniqueFiles = getUniqueFiles(matches);

  // Natural summary: "grep for 'pattern' in path" (truncated to last 2 segments)
  const summary = path ? `in ${truncatePath(path)}` : "";

  const hasExpandedContent = output !== undefined;

  const expandedContent = hasExpandedContent ? (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
      {matches.length > 0 ? (
        <>
          Found {uniqueFiles.length} file{uniqueFiles.length !== 1 ? "s" : ""}
          {"\n"}
          {uniqueFiles.map((f) => f).join("\n")}
        </>
      ) : (
        "No matches"
      )}
    </pre>
  ) : undefined;

  return (
    <ToolLayout
      name="Grep"
      icon={<Search className="h-3.5 w-3.5" />}
      summary={
        <>
          <span className="font-mono">&apos;{pattern}&apos;</span>
          {summary && (
            <span className="ml-1.5 text-muted-foreground/60">{summary}</span>
          )}
        </>
      }
      meta={output ? `${matches.length} matches` : undefined}
      state={state}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
