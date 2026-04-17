import { describe, expect, mock, test } from "bun:test";

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

const {
  deduplicateResults,
  decodeHTMLEntities,
  filterByDomains,
  mapTimeRange,
  parseBraveSearchJSON,
  parseDuckDuckGoHTML,
} = await import("./web-search");

type SearchResult = { title: string; url: string; snippet: string };

describe("decodeHTMLEntities", () => {
  test("decodes common HTML entities", () => {
    expect(decodeHTMLEntities("&amp; &lt; &gt; &quot;")).toBe('& < > "');
  });

  test("decodes apostrophe variants", () => {
    expect(decodeHTMLEntities("it&#x27;s &#39;fine&#39; &apos;ok&apos;")).toBe(
      "it's 'fine' 'ok'",
    );
  });

  test("decodes numeric character references", () => {
    expect(decodeHTMLEntities("&#65;&#66;&#67;")).toBe("ABC");
  });

  test("returns plain text unchanged", () => {
    expect(decodeHTMLEntities("hello world")).toBe("hello world");
  });
});

describe("parseDuckDuckGoHTML", () => {
  test("extracts results from DuckDuckGo HTML", () => {
    const html = `
      <div class="result ">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
        <a class="result__snippet" href="#">This is a helpful snippet about docs</a>
      </div>
      <div class="result ">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Frepo">GitHub Repo</a>
        <a class="result__snippet" href="#">Open source repository</a>
      </div>
    `;

    const results = parseDuckDuckGoHTML(html);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example Docs",
      url: "https://example.com/docs",
      snippet: "This is a helpful snippet about docs",
    });
    expect(results[1]).toEqual({
      title: "GitHub Repo",
      url: "https://github.com/repo",
      snippet: "Open source repository",
    });
  });

  test("handles direct URLs without uddg wrapper", () => {
    const html = `
      <div class="result ">
        <a class="result__a" href="https://direct-link.com/page">Direct Link</a>
        <a class="result__snippet" href="#">Some snippet</a>
      </div>
    `;

    const results = parseDuckDuckGoHTML(html);

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://direct-link.com/page");
  });

  test("returns empty array for non-matching HTML", () => {
    const html = "<html><body><p>No results</p></body></html>";
    expect(parseDuckDuckGoHTML(html)).toEqual([]);
  });

  test("handles results without snippets", () => {
    const html = `
      <div class="result ">
        <a class="result__a" href="https://example.com">Title Only</a>
      </div>
    `;

    const results = parseDuckDuckGoHTML(html);

    expect(results).toHaveLength(1);
    expect(results[0]?.snippet).toBe("");
  });

  test("limits results to MAX_RESULTS (10)", () => {
    let html = "";
    for (let i = 0; i < 15; i++) {
      html += `
        <div class="result ">
          <a class="result__a" href="https://example.com/${i}">Result ${i}</a>
          <a class="result__snippet" href="#">Snippet ${i}</a>
        </div>
      `;
    }

    const results = parseDuckDuckGoHTML(html);
    expect(results.length).toBeLessThanOrEqual(10);
  });
});

describe("parseBraveSearchJSON", () => {
  test("extracts results from valid Brave Search response", () => {
    const json = JSON.stringify({
      web: {
        results: [
          {
            title: "React Docs",
            url: "https://react.dev",
            description: "The library for web and native user interfaces",
          },
          {
            title: "Next.js",
            url: "https://nextjs.org",
            description: "The React Framework for the Web",
          },
        ],
      },
    });

    const results = parseBraveSearchJSON(json);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "React Docs",
      url: "https://react.dev",
      snippet: "The library for web and native user interfaces",
    });
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseBraveSearchJSON("not json")).toEqual([]);
  });

  test("returns empty array when web.results is missing", () => {
    expect(parseBraveSearchJSON(JSON.stringify({ query: "test" }))).toEqual([]);
    expect(parseBraveSearchJSON(JSON.stringify({ web: {} }))).toEqual([]);
    expect(
      parseBraveSearchJSON(JSON.stringify({ web: { results: "not-array" } })),
    ).toEqual([]);
  });

  test("skips entries missing url", () => {
    const json = JSON.stringify({
      web: {
        results: [
          { title: "No URL", description: "Missing URL field" },
          {
            title: "Has URL",
            url: "https://example.com",
            description: "Valid entry",
          },
        ],
      },
    });

    const results = parseBraveSearchJSON(json);
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://example.com");
  });

  test("truncates long descriptions", () => {
    const json = JSON.stringify({
      web: {
        results: [
          {
            title: "Long",
            url: "https://example.com",
            description: "x".repeat(500),
          },
        ],
      },
    });

    const results = parseBraveSearchJSON(json);
    expect(results[0]?.snippet.length).toBeLessThanOrEqual(300);
  });

  test("limits to MAX_RESULTS", () => {
    const results = Array.from({ length: 15 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      description: `Desc ${i}`,
    }));

    const json = JSON.stringify({ web: { results } });
    const parsed = parseBraveSearchJSON(json);
    expect(parsed.length).toBeLessThanOrEqual(10);
  });
});

describe("filterByDomains", () => {
  const results: SearchResult[] = [
    { title: "GH", url: "https://github.com/repo", snippet: "" },
    { title: "SO", url: "https://stackoverflow.com/q/1", snippet: "" },
    { title: "Docs", url: "https://docs.python.org/3/lib", snippet: "" },
    { title: "Blog", url: "https://blog.example.com/post", snippet: "" },
  ];

  test("returns all results when no filters", () => {
    expect(filterByDomains(results, undefined, undefined)).toHaveLength(4);
  });

  test("filters to allowed domains only", () => {
    const filtered = filterByDomains(
      results,
      ["github.com", "docs.python.org"],
      undefined,
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.title)).toEqual(["GH", "Docs"]);
  });

  test("excludes blocked domains", () => {
    const filtered = filterByDomains(results, undefined, ["stackoverflow.com"]);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.title)).toEqual(["GH", "Docs", "Blog"]);
  });

  test("allowed domains match subdomains", () => {
    const filtered = filterByDomains(results, ["example.com"], undefined);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("Blog");
  });

  test("blocked domains match subdomains", () => {
    const filtered = filterByDomains(results, undefined, ["example.com"]);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.title)).toEqual(["GH", "SO", "Docs"]);
  });
});

describe("deduplicateResults", () => {
  test("removes duplicate URLs", () => {
    const results: SearchResult[] = [
      { title: "A", url: "https://example.com/page", snippet: "first" },
      { title: "B", url: "https://example.com/page", snippet: "second" },
      { title: "C", url: "https://other.com/page", snippet: "third" },
    ];

    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.title).toBe("A");
    expect(deduped[1]?.title).toBe("C");
  });

  test("normalizes trailing slashes", () => {
    const results: SearchResult[] = [
      { title: "A", url: "https://example.com/page/", snippet: "" },
      { title: "B", url: "https://example.com/page", snippet: "" },
    ];

    expect(deduplicateResults(results)).toHaveLength(1);
  });

  test("normalizes protocol differences", () => {
    const results: SearchResult[] = [
      { title: "A", url: "https://example.com/page", snippet: "" },
      { title: "B", url: "http://example.com/page", snippet: "" },
    ];

    expect(deduplicateResults(results)).toHaveLength(1);
  });

  test("keeps unique URLs", () => {
    const results: SearchResult[] = [
      { title: "A", url: "https://example.com/a", snippet: "" },
      { title: "B", url: "https://example.com/b", snippet: "" },
    ];

    expect(deduplicateResults(results)).toHaveLength(2);
  });
});

describe("mapTimeRange", () => {
  test("maps time ranges for Brave", () => {
    expect(mapTimeRange("day", "brave")).toBe("pd");
    expect(mapTimeRange("week", "brave")).toBe("pw");
    expect(mapTimeRange("month", "brave")).toBe("pm");
    expect(mapTimeRange("year", "brave")).toBe("py");
  });

  test("maps time ranges for DuckDuckGo", () => {
    expect(mapTimeRange("day", "duckduckgo")).toBe("d");
    expect(mapTimeRange("week", "duckduckgo")).toBe("w");
    expect(mapTimeRange("month", "duckduckgo")).toBe("m");
    expect(mapTimeRange("year", "duckduckgo")).toBe("y");
  });

  test("returns undefined for no time range", () => {
    expect(mapTimeRange(undefined, "brave")).toBeUndefined();
    expect(mapTimeRange(undefined, "duckduckgo")).toBeUndefined();
  });
});
