import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { INTERNAL_API_REJECTED_STATUS } from "@/lib/harness-runner/internal-endpoints";
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

/**
 * The internal-API branch is an optimization, not a control: the same method
 * restriction, signature requirement, and 404/no-store/noindex response are
 * enforced inside the route bundle by `withInternalRouteGuard` (asserted in
 * `app/api/internal/harness-runner/route.test.ts`, which calls the handlers with
 * the proxy skipped). These tests cover the saved work and the fact that this
 * layer only ever drops or forwards — never grants.
 */
describe("internal API proxy pre-filter", () => {
  const signed = { "x-open-agents-harness-signature": "1700000000.deadbeef" };

  function makeInternalRequest(
    method: string,
    headers: Record<string, string> = {},
    path = "/api/internal/harness-runner",
  ) {
    return new NextRequest(`http://localhost${path}`, { method, headers });
  }

  test("forwards a signed POST for the handler to authenticate", () => {
    const response = proxy(makeInternalRequest("POST", signed));

    // Forwarded as-is: the proxy vouches for nothing, so a plausible-looking
    // signature still has to survive verification in the route.
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("drops unsigned requests the same way the route's guard does", () => {
    const response = proxy(makeInternalRequest("POST"));

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("drops browser navigations", () => {
    const response = proxy(makeInternalRequest("GET", signed));

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  test("covers every route under the internal prefix", () => {
    const response = proxy(
      makeInternalRequest("POST", {}, "/api/internal/anything-else"),
    );

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
  });

  test("leaves public API routes untouched", () => {
    const response = proxy(makeInternalRequest("POST", {}, "/api/chat"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
