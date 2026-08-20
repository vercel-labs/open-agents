import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function makeRequest(path: string, accept: string, method = "GET") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Accept: accept },
  });
}

describe("shared page content negotiation proxy", () => {
  test("rewrites markdown requests for shared pages", () => {
    const response = proxy(makeRequest("/shared/share-1", "text/markdown"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost/api/shared/share-1/markdown",
    );
  });

  test("rewrites plain text requests for shared pages", () => {
    const response = proxy(makeRequest("/shared/share-1", "text/plain"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost/api/shared/share-1/markdown",
    );
  });

  test("does not rewrite html page requests", () => {
    const response = proxy(makeRequest("/shared/share-1", "text/html"));

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("does not rewrite non-GET requests", () => {
    const response = proxy(
      makeRequest("/shared/share-1", "text/markdown", "POST"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("internal API isolation proxy", () => {
  const signed = { "x-open-agents-harness-signature": "1700000000.deadbeef" };

  function makeInternalRequest(
    method: string,
    headers: Record<string, string> = {},
    path = "/api/internal/harness-runner",
  ) {
    return new NextRequest(`http://localhost${path}`, { method, headers });
  }

  test("lets a signed POST through to the handler", () => {
    const response = proxy(makeInternalRequest("POST", signed));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("hides internal endpoints from unsigned requests", () => {
    const response = proxy(makeInternalRequest("POST"));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("hides internal endpoints from browser navigations", () => {
    const response = proxy(makeInternalRequest("GET", signed));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  test("covers every route under the internal prefix", () => {
    const response = proxy(
      makeInternalRequest("POST", {}, "/api/internal/anything-else"),
    );

    expect(response.status).toBe(404);
  });

  test("leaves public API routes untouched", () => {
    const response = proxy(makeInternalRequest("POST", {}, "/api/chat"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
