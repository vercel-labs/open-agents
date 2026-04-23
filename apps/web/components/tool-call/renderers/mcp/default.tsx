"use client";

import type { ReactNode } from "react";
import { tryParseStructuredOutput, extractOutputText } from "./shared";
import { SearchResultItem } from "./output-search";
import { PageResultView } from "./output-page";
import { TableResultView } from "./output-table";

export function formatDefaultOutput(rawOutput: unknown): ReactNode | undefined {
  const structured = tryParseStructuredOutput(rawOutput);
  if (structured) {
    switch (structured.kind) {
      case "search":
        return (
          <div className="ml-4 space-y-0">
            {structured.results.map((result, i) => (
              <SearchResultItem key={result.id ?? i} result={result} />
            ))}
          </div>
        );
      case "page":
        return <PageResultView page={structured.page} />;
      case "table":
        return (
          <TableResultView
            rows={structured.rows}
            columns={structured.columns}
          />
        );
    }
  }

  // Fallback: formatted text
  const text = extractOutputText(rawOutput);
  if (!text || text.length === 0) return undefined;
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/50 bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/70">
      {text}
    </pre>
  );
}
