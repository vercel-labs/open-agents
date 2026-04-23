"use client";

import { McpProviderIcon } from "@/components/mcp-icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url?: string;
  type?: string;
  highlight?: string;
  timestamp?: string;
  id?: string;
}

export interface PageResult {
  title: string;
  url?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export type TableRow = Record<string, unknown>;

export type StructuredOutput =
  | { kind: "search"; results: SearchResult[] }
  | { kind: "page"; page: PageResult }
  | { kind: "table"; rows: TableRow[]; columns: string[] };

// ---------------------------------------------------------------------------
// Tool name parsing
// ---------------------------------------------------------------------------

/**
 * Parse an MCP tool name like "mcp_granola_query_granola_meetings"
 * into { provider: "granola", toolName: "query_granola_meetings" }.
 */
export function parseMcpToolName(fullName: string): {
  provider: string;
  toolName: string;
} {
  const withoutPrefix = fullName.slice(4);
  const underscoreIdx = withoutPrefix.indexOf("_");
  if (underscoreIdx === -1) {
    return { provider: withoutPrefix, toolName: withoutPrefix };
  }
  return {
    provider: withoutPrefix.slice(0, underscoreIdx),
    toolName: withoutPrefix.slice(underscoreIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// Action labels
// ---------------------------------------------------------------------------

/**
 * Generate a human-friendly action label from a tool name.
 * Provider-specific label maps can be passed in to override the regex fallback.
 */
export function getActionLabel(
  toolName: string,
  provider: string,
  providerLabels?: Record<string, string>,
): string {
  if (providerLabels) {
    const stripped = toolName
      .replace(`${provider}_`, "")
      .replace(`${provider}-`, "");
    const label = providerLabels[toolName] ?? providerLabels[stripped];
    if (label) return label;
  }

  const capitalized = provider.charAt(0).toUpperCase() + provider.slice(1);
  const lower = toolName.toLowerCase();

  if (/query|search|find|list|get/.test(lower))
    return `Searching ${capitalized}`;
  if (/create|add|insert/.test(lower)) return `Creating in ${capitalized}`;
  if (/update|edit|modify/.test(lower)) return `Updating ${capitalized}`;
  if (/delete|remove/.test(lower)) return `Deleting from ${capitalized}`;
  if (/fetch|read|view/.test(lower)) return `Reading ${capitalized}`;
  if (/move|duplicate|copy/.test(lower)) return `Organizing ${capitalized}`;
  if (/comment/.test(lower)) return `Commenting in ${capitalized}`;
  return `Using ${capitalized}`;
}

// ---------------------------------------------------------------------------
// Input summary
// ---------------------------------------------------------------------------

export function getSummary(input: Record<string, unknown> | undefined): string {
  if (!input) return "...";

  for (const key of [
    "query",
    "search",
    "q",
    "name",
    "title",
    "message",
    "text",
    "content",
    "url",
    "path",
  ]) {
    if (key in input && input[key] != null) {
      const val = input[key];
      if (typeof val === "string") {
        return val.length > 80 ? `${val.slice(0, 77)}...` : val;
      }
      if (typeof val === "object") {
        return summarizeObject(val as Record<string, unknown>);
      }
    }
  }

  for (const [key, val] of Object.entries(input)) {
    if (key === "id" || key === "page_id" || key === "database_id") continue;
    if (typeof val === "string" && val.length > 0 && !isUUID(val)) {
      return val.length > 80 ? `${val.slice(0, 77)}...` : val;
    }
  }

  const parts: string[] = [];
  for (const [_key, val] of Object.entries(input)) {
    if (val == null) continue;
    if (typeof val === "string" && isUUID(val)) continue;
    if (typeof val === "string" && val.length > 0) {
      parts.push(val);
    } else if (typeof val === "object") {
      parts.push(summarizeObject(val as Record<string, unknown>));
    }
    if (parts.join(" ").length > 60) break;
  }
  if (parts.length > 0) {
    const joined = parts.join(" · ");
    return joined.length > 80 ? `${joined.slice(0, 77)}...` : joined;
  }

  return "...";
}

export function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export function summarizeObject(obj: Record<string, unknown>): string {
  const readable: string[] = [];
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.length > 0 && val.length < 60) {
      readable.push(val);
    } else if (typeof val === "object" && val != null) {
      for (const inner of Object.values(val as Record<string, unknown>)) {
        if (
          typeof inner === "string" &&
          inner.length > 0 &&
          inner.length < 60
        ) {
          readable.push(inner);
        }
      }
    }
  }
  if (readable.length > 0) {
    const joined = readable.join(", ");
    return joined.length > 60 ? `${joined.slice(0, 57)}...` : joined;
  }
  const json = JSON.stringify(obj);
  return json.length > 60 ? `${json.slice(0, 57)}...` : json;
}

// ---------------------------------------------------------------------------
// Provider icon
// ---------------------------------------------------------------------------

export function getProviderIcon(provider: string) {
  return (
    <McpProviderIcon provider={provider.toLowerCase()} className="size-4" />
  );
}

// ---------------------------------------------------------------------------
// Extract text content from MCP output
// ---------------------------------------------------------------------------

export function extractOutputText(output: unknown): string | null {
  if (output == null) return null;

  if (typeof output === "object" && "content" in (output as object)) {
    const result = output as { content?: unknown[] };
    if (Array.isArray(result.content)) {
      return result.content
        .map((item) => {
          if (typeof item === "object" && item != null && "text" in item) {
            return String((item as { text: unknown }).text);
          }
          if (typeof item === "string") return item;
          return JSON.stringify(item, null, 2);
        })
        .join("\n");
    }
  }

  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

// ---------------------------------------------------------------------------
// URL & timestamp helpers
// ---------------------------------------------------------------------------

export function isValidExternalUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function formatTimestamp(ts: string): string {
  const cleaned = ts.replace(/\s*\([\d-]+\)\s*$/, "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned;

  try {
    const date = new Date(cleaned);
    if (Number.isNaN(date.getTime())) return cleaned;
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${Math.floor(diffMonths / 12)}y ago`;
  } catch {
    return cleaned;
  }
}

// ---------------------------------------------------------------------------
// Generic structured output parsing
// ---------------------------------------------------------------------------

/**
 * Attempt to parse MCP output into a structured format.
 * This is provider-agnostic — only handles common patterns.
 * Provider-specific parsing (e.g. Notion URL construction) belongs in
 * the provider's own formatter file.
 */
export function tryParseStructuredOutput(
  output: unknown,
): StructuredOutput | null {
  const text = extractOutputText(output);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Array of results with title fields
    if (Array.isArray(parsed.results) && parsed.results.length > 0) {
      const first = parsed.results[0] as Record<string, unknown>;

      if (typeof first.title === "string" || typeof first.Name === "string") {
        // Has URLs or type fields → search results
        const isSearch = parsed.results.some(
          (r: Record<string, unknown>) =>
            isValidExternalUrl(r.url) || typeof r.type === "string",
        );

        if (isSearch) {
          return {
            kind: "search",
            results: (parsed.results as Record<string, unknown>[]).map((r) => ({
              title: (r.title as string) ?? (r.Name as string) ?? "Untitled",
              url: isValidExternalUrl(r.url) ? (r.url as string) : undefined,
              type: (r.type as string) ?? undefined,
              timestamp: (r.timestamp as string) ?? undefined,
              highlight: (r.highlight as string) ?? undefined,
              id: (r.id as string) ?? undefined,
            })),
          };
        }

        // Table-like data
        const columns = Object.keys(first).filter(
          (k) => k !== "id" && k !== "data_source_ids",
        );
        return {
          kind: "table",
          rows: parsed.results as TableRow[],
          columns,
        };
      }
    }

    // Single page/document result: { title, text, ... }
    if (typeof parsed.title === "string" && typeof parsed.text === "string") {
      return {
        kind: "page",
        page: {
          title: parsed.title as string,
          url: isValidExternalUrl(parsed.url)
            ? (parsed.url as string)
            : undefined,
          text: parsed.text as string,
          metadata: parsed.metadata as Record<string, unknown> | undefined,
        },
      };
    }
  } catch {
    // not JSON
  }
  return null;
}
