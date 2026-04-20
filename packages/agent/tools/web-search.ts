import { tool } from "ai";
import { z } from "zod";
import { getSandbox, shellEscape } from "./utils";

const TIMEOUT_MS = 30_000;
const MAX_RESULTS = 10;
const MAX_SNIPPET_LENGTH = 300;

/**
 * Supported search engines.
 *
 * - "auto"   — tries Brave (if BRAVE_SEARCH_API_KEY is set), then falls back to DuckDuckGo HTML.
 * - "brave"  — Brave Search API (requires BRAVE_SEARCH_API_KEY in sandbox env).
 * - "duckduckgo" — DuckDuckGo HTML scraping (no API key needed, always available).
 */
type SearchEngine = "auto" | "brave" | "duckduckgo";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML parser
// ---------------------------------------------------------------------------

function parseDuckDuckGoHTML(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results live inside <a class="result__a" ...> for titles/URLs
  // and <a class="result__snippet" ...> for snippets.
  const resultBlocks = html.split(/class="result\s/g);

  for (const block of resultBlocks) {
    if (results.length >= MAX_RESULTS) break;

    // Extract URL from result__a href
    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    // Extract title text from result__a
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
    // Extract snippet from result__snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+)</);

    if (urlMatch?.[1] && titleMatch?.[1]) {
      let url = urlMatch[1];
      // DuckDuckGo wraps URLs in a redirect — extract the actual target
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch?.[1]) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      results.push({
        title: decodeHTMLEntities(titleMatch[1].trim()),
        url,
        snippet: snippetMatch?.[1]
          ? decodeHTMLEntities(snippetMatch[1].trim()).slice(
              0,
              MAX_SNIPPET_LENGTH,
            )
          : "",
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Brave Search JSON parser
// ---------------------------------------------------------------------------

function parseBraveSearchJSON(json: string): SearchResult[] {
  const results: SearchResult[] = [];

  try {
    const data: unknown = JSON.parse(json);
    if (typeof data !== "object" || data === null || !("web" in data)) {
      return results;
    }

    const web = (data as Record<string, unknown>).web;
    if (typeof web !== "object" || web === null || !("results" in web)) {
      return results;
    }

    const rawResults = (web as Record<string, unknown>).results;
    if (!Array.isArray(rawResults)) return results;

    for (const item of rawResults) {
      if (results.length >= MAX_RESULTS) break;
      if (typeof item !== "object" || item === null) continue;

      const entry = item as Record<string, unknown>;
      const title = typeof entry.title === "string" ? entry.title : "";
      const url = typeof entry.url === "string" ? entry.url : "";
      const snippet =
        typeof entry.description === "string"
          ? entry.description.slice(0, MAX_SNIPPET_LENGTH)
          : "";

      if (url) {
        results.push({ title, url, snippet });
      }
    }
  } catch {
    // JSON parse failure — return empty results
  }

  return results;
}

// ---------------------------------------------------------------------------
// HTML entity decoder (lightweight, no external deps)
// ---------------------------------------------------------------------------

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCharCode(parseInt(dec, 10)),
    );
}

// ---------------------------------------------------------------------------
// Search execution helpers
// ---------------------------------------------------------------------------

function buildDuckDuckGoCommand(
  query: string,
  timeRange: string | undefined,
): string {
  let searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  if (timeRange) {
    searchUrl += `&df=${encodeURIComponent(timeRange)}`;
  }

  return [
    "curl",
    "-sS",
    "--max-time",
    String(Math.ceil(TIMEOUT_MS / 1000)),
    "-H",
    shellEscape("User-Agent: Mozilla/5.0 (compatible; OpenHarnessAgent/1.0)"),
    shellEscape(searchUrl),
  ].join(" ");
}

function buildBraveSearchCommand(
  query: string,
  apiKey: string,
  count: number,
  timeRange: string | undefined,
): string {
  let searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  if (timeRange) {
    // Brave uses freshness param: pd (past day), pw (past week), pm (past month), py (past year)
    searchUrl += `&freshness=${encodeURIComponent(timeRange)}`;
  }

  return [
    "curl",
    "-sS",
    "--max-time",
    String(Math.ceil(TIMEOUT_MS / 1000)),
    "-H",
    shellEscape("Accept: application/json"),
    "-H",
    shellEscape(`X-Subscription-Token: ${apiKey}`),
    shellEscape(searchUrl),
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Domain filtering
// ---------------------------------------------------------------------------

function filterByDomains(
  results: SearchResult[],
  allowedDomains: string[] | undefined,
  blockedDomains: string[] | undefined,
): SearchResult[] {
  let filtered = results;

  if (allowedDomains && allowedDomains.length > 0) {
    filtered = filtered.filter((r) => {
      try {
        const hostname = new URL(r.url).hostname;
        return allowedDomains.some(
          (d) => hostname === d || hostname.endsWith(`.${d}`),
        );
      } catch {
        return false;
      }
    });
  }

  if (blockedDomains && blockedDomains.length > 0) {
    filtered = filtered.filter((r) => {
      try {
        const hostname = new URL(r.url).hostname;
        return !blockedDomains.some(
          (d) => hostname === d || hostname.endsWith(`.${d}`),
        );
      } catch {
        return true;
      }
    });
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    // Normalize URL by removing trailing slash and protocol
    const normalized = r.url
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tool schema and implementation
// ---------------------------------------------------------------------------

const webSearchInputSchema = z.object({
  query: z.string().describe("The search query"),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Number of results to return (1-10). Default: 5"),
  engine: z
    .enum(["auto", "brave", "duckduckgo"])
    .optional()
    .describe(
      'Search engine to use. "auto" tries Brave (if API key available) then DuckDuckGo. Default: "auto"',
    ),
  timeRange: z
    .enum(["day", "week", "month", "year"])
    .optional()
    .describe("Filter results by recency. Omit for all-time results"),
  allowedDomains: z
    .array(z.string())
    .optional()
    .describe(
      'Only include results from these domains (e.g., ["github.com", "docs.python.org"])',
    ),
  blockedDomains: z
    .array(z.string())
    .optional()
    .describe('Exclude results from these domains (e.g., ["pinterest.com"])'),
});

/** Map user-friendly time ranges to engine-specific parameters. */
function mapTimeRange(
  timeRange: string | undefined,
  engine: "brave" | "duckduckgo",
): string | undefined {
  if (!timeRange) return undefined;

  if (engine === "brave") {
    const braveMap: Record<string, string> = {
      day: "pd",
      week: "pw",
      month: "pm",
      year: "py",
    };
    return braveMap[timeRange];
  }

  // DuckDuckGo time filters
  const ddgMap: Record<string, string> = {
    day: "d",
    week: "w",
    month: "m",
    year: "y",
  };
  return ddgMap[timeRange];
}

export const webSearchTool = tool({
  description: `Search the web for information using a search engine.

WHEN TO USE:
- Finding documentation, tutorials, or API references for libraries and frameworks
- Researching error messages, stack traces, or debugging unfamiliar issues
- Looking up current best practices, changelogs, or release notes
- Discovering solutions on StackOverflow, GitHub issues, or dev blogs
- Checking the latest version or compatibility info for packages
- Gathering context about tools, services, or technologies the user references

WHEN NOT TO USE:
- Fetching a specific known URL (use web_fetch instead)
- Searching within the project's own codebase (use grep/glob instead)
- Questions answerable from existing project files or context

USAGE:
- Provide a clear, specific search query for best results
- Use timeRange to filter for recent results (e.g., "week" for latest docs)
- Use allowedDomains to restrict results to trusted sources
- Use blockedDomains to exclude irrelevant or low-quality sites
- Engine "auto" selects the best available engine (Brave if API key set, otherwise DuckDuckGo)

EXAMPLES:
- Search docs: query: "Next.js 15 app router middleware configuration"
- Recent results: query: "bun 1.2 breaking changes", timeRange: "month"
- Scoped search: query: "React server components", allowedDomains: ["react.dev", "github.com"]
- Debug help: query: "TypeError: Cannot read properties of undefined React hydration"`,
  inputSchema: webSearchInputSchema,
  execute: async (
    {
      query,
      count = 5,
      engine = "auto",
      timeRange,
      allowedDomains,
      blockedDomains,
    },
    { experimental_context, abortSignal },
  ) => {
    const sandbox = await getSandbox(experimental_context, "web_search");
    const workingDirectory = sandbox.workingDirectory;

    // Determine which engine to use
    let selectedEngine: "brave" | "duckduckgo" = "duckduckgo";
    let braveApiKey: string | undefined;

    if (engine === "brave" || engine === "auto") {
      // Check for Brave API key in sandbox environment
      try {
        const envResult = await sandbox.exec(
          "echo $BRAVE_SEARCH_API_KEY",
          workingDirectory,
          5_000,
          { signal: abortSignal },
        );
        const key = envResult.stdout?.trim();
        if (key && key.length > 0) {
          braveApiKey = key;
          selectedEngine = "brave";
        } else if (engine === "brave") {
          return {
            success: false,
            error:
              'Brave Search API key not found. Set BRAVE_SEARCH_API_KEY environment variable, or use engine: "auto" to fall back to DuckDuckGo.',
          };
        }
      } catch {
        if (engine === "brave") {
          return {
            success: false,
            error:
              'Failed to check for Brave Search API key. Use engine: "auto" or "duckduckgo" instead.',
          };
        }
      }
    }

    const mappedTimeRange = mapTimeRange(timeRange, selectedEngine);

    try {
      let command: string;
      let parseResults: (output: string) => SearchResult[];

      if (selectedEngine === "brave" && braveApiKey) {
        command = buildBraveSearchCommand(
          query,
          braveApiKey,
          count,
          mappedTimeRange,
        );
        parseResults = parseBraveSearchJSON;
      } else {
        command = buildDuckDuckGoCommand(query, mappedTimeRange);
        parseResults = parseDuckDuckGoHTML;
      }

      const result = await sandbox.exec(command, workingDirectory, TIMEOUT_MS, {
        signal: abortSignal,
      });

      if (!result.success) {
        return {
          success: false,
          error: `Search request failed: ${result.stderr || "Unknown error"}`,
          engine: selectedEngine,
        };
      }

      let results = parseResults(result.stdout ?? "");

      // Apply domain filtering
      results = filterByDomains(results, allowedDomains, blockedDomains);

      // Deduplicate
      results = deduplicateResults(results);

      // Trim to requested count
      results = results.slice(0, count);

      return {
        success: true,
        engine: selectedEngine,
        query,
        resultCount: results.length,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Search failed: ${message}`,
        engine: selectedEngine,
      };
    }
  },
});

// Exported for testing
export {
  parseDuckDuckGoHTML,
  parseBraveSearchJSON,
  decodeHTMLEntities,
  filterByDomains,
  deduplicateResults,
  mapTimeRange,
  type SearchResult,
  type SearchEngine,
};
