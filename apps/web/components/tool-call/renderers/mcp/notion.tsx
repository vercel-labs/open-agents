"use client";

import type { ReactNode } from "react";
import {
  extractOutputText,
  isValidExternalUrl,
  tryParseStructuredOutput,
  type SearchResult,
} from "./shared";
import { SearchResultItem } from "./output-search";
import { PageResultView } from "./output-page";
import { TableResultView } from "./output-table";

// ---------------------------------------------------------------------------
// Notion-specific tool labels
// ---------------------------------------------------------------------------

export const NOTION_TOOL_LABELS: Record<string, string> = {
  search: "Searching Notion",
  fetch: "Reading Notion page",
  create_pages: "Creating Notion pages",
  "create-pages": "Creating Notion pages",
  update_page: "Updating Notion page",
  "update-page": "Updating Notion page",
  move_pages: "Moving Notion pages",
  "move-pages": "Moving Notion pages",
  duplicate_page: "Duplicating Notion page",
  "duplicate-page": "Duplicating Notion page",
  create_database: "Creating Notion database",
  "create-database": "Creating Notion database",
  update_data_source: "Updating Notion data source",
  "update-data-source": "Updating Notion data source",
  create_view: "Creating Notion view",
  "create-view": "Creating Notion view",
  update_view: "Updating Notion view",
  "update-view": "Updating Notion view",
  query_data_sources: "Querying Notion",
  "query-data-sources": "Querying Notion",
  query_database_view: "Querying Notion database",
  "query-database-view": "Querying Notion database",
  create_comment: "Commenting in Notion",
  "create-comment": "Commenting in Notion",
  get_comments: "Reading Notion comments",
  "get-comments": "Reading Notion comments",
  get_teams: "Getting Notion teams",
  "get-teams": "Getting Notion teams",
  get_users: "Listing Notion users",
  "get-users": "Listing Notion users",
  get_user: "Getting Notion user",
  "get-user": "Getting Notion user",
  get_self: "Getting Notion bot info",
  "get-self": "Getting Notion bot info",
};

// ---------------------------------------------------------------------------
// Notion-specific output enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich search results with Notion-specific logic:
 * - Construct notion.so URLs from IDs when no URL is present
 * - Default type to "notion" for notion.so URLs
 * - Pick up Notion-specific timestamp fields
 */
function enrichNotionSearchResults(
  results: Record<string, unknown>[],
): SearchResult[] {
  return results.map((r) => {
    const directUrl = isValidExternalUrl(r.url) ? (r.url as string) : null;
    const idUrl =
      !directUrl && typeof r.id === "string" && (r.id as string).length > 10
        ? `https://www.notion.so/${(r.id as string).replace(/-/g, "")}`
        : null;
    const url = directUrl ?? idUrl ?? undefined;

    return {
      title: (r.title as string) ?? (r.Name as string) ?? "Untitled",
      url,
      type:
        (r.type as string) ??
        (url?.includes("notion.so") ? "notion" : undefined),
      timestamp:
        (r.timestamp as string) ??
        (r.lastEditedTime as string) ??
        (r.last_edited_time as string) ??
        (r.created_time as string) ??
        undefined,
      highlight: (r.highlight as string) ?? undefined,
      id: (r.id as string) ?? undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Notion output formatter
// ---------------------------------------------------------------------------

export function formatNotionOutput(rawOutput: unknown): ReactNode | undefined {
  const text = extractOutputText(rawOutput);
  if (!text) return undefined;

  // Try Notion-specific parsing first (with URL enrichment)
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Search results with Notion enrichment
    if (Array.isArray(parsed.results) && parsed.results.length > 0) {
      const first = parsed.results[0] as Record<string, unknown>;

      if (typeof first.title === "string" || typeof first.Name === "string") {
        const hasSearchFields = parsed.results.some(
          (r: Record<string, unknown>) =>
            isValidExternalUrl(r.url) ||
            typeof r.type === "string" ||
            (typeof r.id === "string" && (r.id as string).length > 10),
        );

        if (hasSearchFields) {
          const enriched = enrichNotionSearchResults(
            parsed.results as Record<string, unknown>[],
          );
          return (
            <div className="ml-4 space-y-0">
              {enriched.map((result, i) => (
                <SearchResultItem key={result.id ?? i} result={result} />
              ))}
            </div>
          );
        }

        // Table-like data
        const columns = Object.keys(first).filter(
          (k) => k !== "id" && k !== "data_source_ids",
        );
        return (
          <TableResultView
            rows={parsed.results as Record<string, unknown>[]}
            columns={columns}
          />
        );
      }
    }

    // Single page result
    if (typeof parsed.title === "string" && typeof parsed.text === "string") {
      return (
        <PageResultView
          page={{
            title: parsed.title as string,
            url: isValidExternalUrl(parsed.url)
              ? (parsed.url as string)
              : undefined,
            text: parsed.text as string,
            metadata: parsed.metadata as Record<string, unknown> | undefined,
          }}
        />
      );
    }
  } catch {
    // not JSON
  }

  // Fall back to generic structured parsing
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

  return undefined;
}
