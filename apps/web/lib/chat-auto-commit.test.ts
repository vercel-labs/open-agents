import { beforeEach, describe, expect, mock, test } from "bun:test";
import { runAutoCommitInBackground } from "./chat-auto-commit";

interface MockFetchResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}

function createMockResponse(response: MockFetchResponse): Response {
  return {
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? (response.ok ? "OK" : "Error"),
    json: response.json ?? (async () => ({})),
  } as unknown as Response;
}

describe("runAutoCommitInBackground", () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];

  const logger = {
    warn: (...data: unknown[]) => {
      warnings.push(data);
    },
    error: (...data: unknown[]) => {
      errors.push(data);
    },
  };

  const baseParams = {
    requestUrl: "http://localhost/api/chat",
    cookieHeader: "session=abc",
    sessionId: "session-1",
    sessionTitle: "Test session",
    repoOwner: "acme",
    repoName: "repo",
    logger,
  };

  beforeEach(() => {
    fetchCalls.length = 0;
    warnings.length = 0;
    errors.length = 0;
  });

  test("uses the repository default branch and refreshes cached diff", async () => {
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });

      switch (fetchCalls.length) {
        case 1:
          return Promise.resolve(
            createMockResponse({
              ok: true,
              json: async () => ({ defaultBranch: "trunk" }),
            }),
          );
        case 2:
          return Promise.resolve(createMockResponse({ ok: true }));
        case 3:
          return Promise.resolve(createMockResponse({ ok: true }));
        default:
          throw new Error("Unexpected fetch call");
      }
    }) as unknown as typeof fetch;

    await runAutoCommitInBackground({
      ...baseParams,
      fetchImpl,
    });

    expect(String(fetchCalls[0]?.input)).toBe(
      "http://localhost/api/github/branches?owner=acme&repo=repo",
    );
    expect(fetchCalls[0]?.init?.method).toBe("GET");
    expect(fetchCalls[0]?.init?.headers).toEqual({ cookie: "session=abc" });

    expect(String(fetchCalls[1]?.input)).toBe(
      "http://localhost/api/generate-pr",
    );
    expect(fetchCalls[1]?.init?.method).toBe("POST");
    expect(fetchCalls[1]?.init?.headers).toEqual({
      cookie: "session=abc",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(fetchCalls[1]?.init?.body))).toEqual({
      sessionId: "session-1",
      sessionTitle: "Test session",
      baseBranch: "trunk",
      branchName: "HEAD",
      commitOnly: true,
    });

    expect(String(fetchCalls[2]?.input)).toBe(
      "http://localhost/api/sessions/session-1/diff",
    );
    expect(fetchCalls[2]?.init?.method).toBe("GET");
    expect(fetchCalls[2]?.init?.headers).toEqual({ cookie: "session=abc" });
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  test("falls back to main when default branch lookup fails", async () => {
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });

      switch (fetchCalls.length) {
        case 1:
          return Promise.resolve(
            createMockResponse({ ok: false, status: 500, statusText: "Error" }),
          );
        case 2:
          return Promise.resolve(createMockResponse({ ok: true }));
        case 3:
          return Promise.resolve(createMockResponse({ ok: true }));
        default:
          throw new Error("Unexpected fetch call");
      }
    }) as unknown as typeof fetch;

    await runAutoCommitInBackground({
      ...baseParams,
      fetchImpl,
    });

    expect(JSON.parse(String(fetchCalls[1]?.init?.body))).toEqual({
      sessionId: "session-1",
      sessionTitle: "Test session",
      baseBranch: "main",
      branchName: "HEAD",
      commitOnly: true,
    });
    expect(warnings).toEqual([
      [
        "[chat] Failed to resolve default branch for auto commit in session session-1: 500",
      ],
    ]);
    expect(errors).toHaveLength(0);
  });

  test("logs commit failures and skips cached diff refresh", async () => {
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });

      switch (fetchCalls.length) {
        case 1:
          return Promise.resolve(
            createMockResponse({
              ok: true,
              json: async () => ({ defaultBranch: "main" }),
            }),
          );
        case 2:
          return Promise.resolve(
            createMockResponse({
              ok: false,
              status: 403,
              statusText: "Forbidden",
              json: async () => ({ error: "Permission denied" }),
            }),
          );
        default:
          throw new Error("Unexpected fetch call");
      }
    }) as unknown as typeof fetch;

    await runAutoCommitInBackground({
      ...baseParams,
      fetchImpl,
    });

    expect(fetchCalls).toHaveLength(2);
    expect(errors).toEqual([
      ["[chat] Auto commit failed for session session-1: Permission denied"],
    ]);
  });
});
