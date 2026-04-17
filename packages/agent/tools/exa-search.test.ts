import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Keep this mock compatible with tools.test.ts's `ai` mock so the two suites
// can run in the same process without one stripping exports the other needs.
mock.module("ai", () => {
  class MockToolLoopAgent {
    constructor(_config: unknown) {}
    stream() {
      throw new Error(
        "MockToolLoopAgent.stream should not be called in this test",
      );
    }
  }
  return {
    tool: <T extends Record<string, unknown>>(definition: T) => definition,
    gateway: (modelId: string) => ({ modelId }),
    stepCountIs: (count: number) => ({ count }),
    ToolLoopAgent: MockToolLoopAgent,
    getToolName: (part: { toolName?: string; type?: string }) => {
      if (part.toolName) return part.toolName;
      if (typeof part.type === "string" && part.type.startsWith("tool-")) {
        return part.type.slice(5);
      }
      return "";
    },
    isToolUIPart: (part: unknown) => {
      if (!part || typeof part !== "object") return false;
      const candidate = part as { type?: unknown };
      return (
        typeof candidate.type === "string" && candidate.type.startsWith("tool-")
      );
    },
  };
});

const { buildExaRequestBody, formatExaResponse, exaSearchTool } =
  await import("./exa-search");

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.EXA_API_KEY;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.EXA_API_KEY;
  } else {
    process.env.EXA_API_KEY = ORIGINAL_API_KEY;
  }
});

describe("buildExaRequestBody", () => {
  test("applies defaults and requests text/highlights/summary content", () => {
    const body = buildExaRequestBody({ query: "drizzle migrations" });

    expect(body).toMatchObject({
      query: "drizzle migrations",
      type: "auto",
      numResults: 5,
    });
    expect(body.contents).toMatchObject({
      text: { maxCharacters: 2_000 },
      highlights: { numSentences: 3, highlightsPerUrl: 2 },
      summary: true,
    });
  });

  test("includes optional filters only when provided", () => {
    const body = buildExaRequestBody({
      query: "next.js streaming",
      type: "neural",
      category: "github",
      numResults: 10,
      includeDomains: ["github.com"],
      excludeDomains: ["medium.com"],
      includeText: ["server component"],
      startPublishedDate: "2024-01-01",
    });

    expect(body).toMatchObject({
      query: "next.js streaming",
      type: "neural",
      category: "github",
      numResults: 10,
      includeDomains: ["github.com"],
      excludeDomains: ["medium.com"],
      includeText: ["server component"],
      startPublishedDate: "2024-01-01",
    });
    expect(body).not.toHaveProperty("excludeText");
    expect(body).not.toHaveProperty("endPublishedDate");
  });
});

describe("formatExaResponse content fallbacks", () => {
  test("prefers highlights over summary and text", () => {
    const out = formatExaResponse(
      {
        results: [
          {
            title: "Drizzle Docs",
            url: "https://orm.drizzle.team/docs/migrations",
            highlights: [
              "Use drizzle-kit generate",
              "Then drizzle-kit migrate",
            ],
            summary: "Fallback summary",
            text: "Fallback text",
          },
        ],
      },
      "drizzle migrations",
    );

    const first = out.results[0];
    expect(out.resultCount).toBe(1);
    expect(first?.snippet).toBe(
      "Use drizzle-kit generate ... Then drizzle-kit migrate",
    );
  });

  test("falls back to summary when highlights are missing", () => {
    const out = formatExaResponse(
      {
        results: [
          {
            title: "Article",
            url: "https://example.com/a",
            summary: "Summary text only",
          },
        ],
      },
      "q",
    );

    expect(out.results[0]?.snippet).toBe("Summary text only");
  });

  test("falls back to text when highlights and summary are missing", () => {
    const out = formatExaResponse(
      {
        results: [
          {
            title: "Article",
            url: "https://example.com/b",
            text: "Body text only",
          },
        ],
      },
      "q",
    );

    expect(out.results[0]?.snippet).toBe("Body text only");
  });

  test("returns an empty snippet when all content fields are missing", () => {
    const out = formatExaResponse(
      {
        results: [{ title: "Article", url: "https://example.com/c" }],
      },
      "q",
    );

    expect(out.results[0]?.snippet).toBe("");
  });

  test("ignores empty highlight arrays and falls through to summary", () => {
    const out = formatExaResponse(
      {
        results: [
          {
            title: "Article",
            url: "https://example.com/d",
            highlights: [],
            summary: "Summary",
          },
        ],
      },
      "q",
    );

    expect(out.results[0]?.snippet).toBe("Summary");
  });

  test("substitutes a placeholder title when title is missing", () => {
    const out = formatExaResponse(
      {
        results: [{ url: "https://example.com/e", summary: "Summary" }],
      },
      "q",
    );

    expect(out.results[0]?.title).toBe("(untitled)");
  });

  test("preserves publishedDate and author when present", () => {
    const out = formatExaResponse(
      {
        results: [
          {
            title: "T",
            url: "https://example.com/f",
            publishedDate: "2024-05-01",
            author: "Jane Doe",
            summary: "S",
          },
        ],
      },
      "q",
    );

    expect(out.results[0]?.publishedDate).toBe("2024-05-01");
    expect(out.results[0]?.author).toBe("Jane Doe");
  });
});

describe("exaSearchTool execute", () => {
  test("returns an error when EXA_API_KEY is not set", async () => {
    delete process.env.EXA_API_KEY;

    const result = await exaSearchTool.execute?.(
      { query: "anything" },
      { toolCallId: "1", messages: [] },
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("EXA_API_KEY"),
    });
  });

  describe("with EXA_API_KEY set", () => {
    beforeEach(() => {
      process.env.EXA_API_KEY = "test-key";
    });

    test("calls the Exa API with auth and integration headers", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        capturedUrl = typeof input === "string" ? input : String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ requestId: "r1", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const result = await exaSearchTool.execute?.(
        { query: "hello world" },
        { toolCallId: "1", messages: [] },
      );

      expect(capturedUrl).toBe("https://api.exa.ai/search");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("test-key");
      expect(headers["x-exa-integration"]).toBe("open-agents");
      expect(headers["Content-Type"]).toBe("application/json");
      const sentBody = JSON.parse(capturedInit?.body as string);
      expect(sentBody.query).toBe("hello world");
      expect(sentBody.type).toBe("auto");
      expect(result).toMatchObject({
        success: true,
        query: "hello world",
        resultCount: 0,
      });
    });

    test("formats a successful API response into snippet results", async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Vercel AI SDK",
                url: "https://sdk.vercel.ai/docs",
                publishedDate: "2025-01-15",
                highlights: ["streamText returns a stream"],
              },
              {
                title: "Repo",
                url: "https://github.com/vercel/ai",
                summary: "Open source AI toolkit",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as unknown as typeof fetch;

      const result = await exaSearchTool.execute?.(
        { query: "vercel ai sdk" },
        { toolCallId: "1", messages: [] },
      );

      expect(result).toMatchObject({
        success: true,
        resultCount: 2,
        results: [
          {
            title: "Vercel AI SDK",
            url: "https://sdk.vercel.ai/docs",
            publishedDate: "2025-01-15",
            snippet: "streamText returns a stream",
          },
          {
            title: "Repo",
            url: "https://github.com/vercel/ai",
            snippet: "Open source AI toolkit",
          },
        ],
      });
    });

    test("returns an error result for non-2xx responses", async () => {
      globalThis.fetch = (async () =>
        new Response("Unauthorized", {
          status: 401,
        })) as unknown as typeof fetch;

      const result = await exaSearchTool.execute?.(
        { query: "hello" },
        { toolCallId: "1", messages: [] },
      );

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("status 401"),
      });
    });

    test("returns an error result when fetch throws", async () => {
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;

      const result = await exaSearchTool.execute?.(
        { query: "hello" },
        { toolCallId: "1", messages: [] },
      );

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("network down"),
      });
    });
  });
});
