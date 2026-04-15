import { tool } from "ai";
import { z } from "zod";

const EXA_API_URL = "https://api.exa.ai/search";
const TIMEOUT_MS = 30_000;
const DEFAULT_NUM_RESULTS = 5;
const MAX_NUM_RESULTS = 25;
const MAX_TEXT_CHARS = 2_000;
const MAX_HIGHLIGHT_CHARS = 500;
const MAX_SUMMARY_CHARS = 1_000;
const INTEGRATION_HEADER = "open-agents";

const exaSearchInputSchema = z.object({
  query: z.string().min(1).describe("The search query"),
  type: z
    .enum(["auto", "neural", "fast", "instant"])
    .optional()
    .describe(
      "Search method. 'auto' (default) intelligently combines methods. 'neural' is embeddings-based. 'fast' / 'instant' minimize latency.",
    ),
  category: z
    .enum([
      "company",
      "research paper",
      "news",
      "personal site",
      "financial report",
      "people",
      "github",
    ])
    .optional()
    .describe(
      "Optional content category to focus the search. Use 'github' for code/repos, 'research paper' for academic sources, etc.",
    ),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_NUM_RESULTS)
    .optional()
    .describe(
      `Number of results (1-${MAX_NUM_RESULTS}). Default: ${DEFAULT_NUM_RESULTS}.`,
    ),
  includeDomains: z
    .array(z.string())
    .optional()
    .describe("Restrict results to these domains (e.g., ['github.com'])."),
  excludeDomains: z
    .array(z.string())
    .optional()
    .describe("Exclude results from these domains."),
  includeText: z
    .array(z.string())
    .max(1)
    .optional()
    .describe(
      "Require results to contain this exact phrase (max one phrase, up to 5 words).",
    ),
  excludeText: z
    .array(z.string())
    .max(1)
    .optional()
    .describe(
      "Exclude results that contain this exact phrase (max one phrase, up to 5 words).",
    ),
  startPublishedDate: z
    .string()
    .optional()
    .describe(
      "ISO 8601 date. Only return results published on/after this date.",
    ),
  endPublishedDate: z
    .string()
    .optional()
    .describe(
      "ISO 8601 date. Only return results published on/before this date.",
    ),
});

type ExaSearchInput = z.infer<typeof exaSearchInputSchema>;

interface ExaApiResult {
  id?: string;
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  author?: string | null;
  text?: string | null;
  highlights?: string[] | null;
  summary?: string | null;
}

interface ExaApiResponse {
  requestId?: string;
  results?: ExaApiResult[];
}

interface ExaFormattedResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  snippet: string;
}

/**
 * Build a snippet from whichever content fields the API returned, in priority
 * order: highlights -> summary -> text. Returns an empty string if nothing
 * was provided.
 */
function buildSnippet(result: ExaApiResult): string {
  const highlights = result.highlights;
  if (Array.isArray(highlights) && highlights.length > 0) {
    const joined = highlights.filter(Boolean).join(" ... ");
    if (joined) return joined.slice(0, MAX_HIGHLIGHT_CHARS);
  }

  if (typeof result.summary === "string" && result.summary.length > 0) {
    return result.summary.slice(0, MAX_SUMMARY_CHARS);
  }

  if (typeof result.text === "string" && result.text.length > 0) {
    return result.text.slice(0, MAX_TEXT_CHARS);
  }

  return "";
}

function formatResult(result: ExaApiResult): ExaFormattedResult {
  const formatted: ExaFormattedResult = {
    title: result.title ?? "(untitled)",
    url: result.url ?? "",
    snippet: buildSnippet(result),
  };
  if (result.publishedDate) formatted.publishedDate = result.publishedDate;
  if (result.author) formatted.author = result.author;
  return formatted;
}

export function buildExaRequestBody(input: ExaSearchInput) {
  const body: Record<string, unknown> = {
    query: input.query,
    type: input.type ?? "auto",
    numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
    contents: {
      text: { maxCharacters: MAX_TEXT_CHARS },
      highlights: { numSentences: 3, highlightsPerUrl: 2 },
      summary: true,
    },
  };

  if (input.category) body.category = input.category;
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
  if (input.includeText?.length) body.includeText = input.includeText;
  if (input.excludeText?.length) body.excludeText = input.excludeText;
  if (input.startPublishedDate)
    body.startPublishedDate = input.startPublishedDate;
  if (input.endPublishedDate) body.endPublishedDate = input.endPublishedDate;

  return body;
}

export function formatExaResponse(
  json: ExaApiResponse,
  query: string,
): {
  success: true;
  query: string;
  resultCount: number;
  results: ExaFormattedResult[];
} {
  const results = (json.results ?? []).map(formatResult);
  return {
    success: true,
    query,
    resultCount: results.length,
    results,
  };
}

export const exaSearchTool = tool({
  description: `Search the web with Exa, an AI-powered search engine.

WHEN TO USE:
- Look up library/API documentation when you need to use a package you don't know
- Find code examples on GitHub for a specific pattern, library, or error
- Research a build/runtime error message you've never seen before
- Pull current information from the web that isn't in the codebase

WHEN NOT TO USE:
- Searching the local codebase (use grep/glob instead)
- Fetching a known URL (use web_fetch instead)

USAGE:
- Provide a focused, natural-language query (Exa understands intent better than keyword stuffing)
- Use 'category: "github"' for code/repo searches, 'category: "research paper"' for academic sources
- Use 'includeDomains' to scope to specific sites (e.g., ['stackoverflow.com'] or ['docs.python.org'])
- Set 'numResults' modestly (default ${DEFAULT_NUM_RESULTS}); raise only if you need broader coverage
- Each result includes a snippet built from highlights, summary, or text (whichever the API returns)

REQUIREMENTS:
- The 'EXA_API_KEY' environment variable must be set. If it isn't, this tool returns an error and you should fall back to web_fetch with a known URL or ask the user.

EXAMPLES:
- Find docs: query: "drizzle-orm migrations cli usage", numResults: 5
- Find code: query: "next.js streaming server component example", category: "github"
- Debug an error: query: "TypeError Cannot read properties of undefined reading 'map' react", includeDomains: ["stackoverflow.com"]`,
  inputSchema: exaSearchInputSchema,
  execute: async (input, { abortSignal }) => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "EXA_API_KEY is not set. Add it to the environment to enable Exa search.",
      };
    }

    const body = buildExaRequestBody(input);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const onAbort = () => controller.abort();
    abortSignal?.addEventListener("abort", onAbort);

    try {
      const response = await fetch(EXA_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "x-exa-integration": INTEGRATION_HEADER,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          success: false,
          error: `Exa search failed (status ${response.status}): ${errorText.slice(0, 500)}`,
        };
      }

      const json = (await response.json()) as ExaApiResponse;
      return formatExaResponse(json, input.query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Exa search failed: ${message}`,
      };
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  },
});
