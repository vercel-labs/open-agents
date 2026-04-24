import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  commitAndPushSessionChanges,
  createSessionBranch,
  fetchRepoBranches,
  generatePullRequestContent,
  requestGeneratePr,
} from "./git-flow-client";

const originalFetch = globalThis.fetch;

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

describe("git-flow-client", () => {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];

  beforeEach(() => {
    fetchCalls.length = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetchRepoBranches returns parsed branches and default branch", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({
            branches: ["main", "feature/one", 123],
            defaultBranch: "main",
          }),
        }),
      );
    }) as unknown as typeof fetch;

    const result = await fetchRepoBranches("acme", "repo");

    expect(String(fetchCalls[0]?.input)).toBe(
      "/api/github/branches?owner=acme&repo=repo",
    );
    expect(result).toEqual({
      branches: ["main", "feature/one"],
      defaultBranch: "main",
    });
  });

  test("fetchRepoBranches falls back to main when default branch is missing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({ branches: ["dev"] }),
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await fetchRepoBranches("acme", "repo");

    expect(result.defaultBranch).toBe("main");
    expect(result.branches).toEqual(["dev"]);
  });

  test("fetchRepoBranches throws on non-ok response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse({ ok: false, status: 500 })),
    ) as unknown as typeof fetch;

    await expect(fetchRepoBranches("acme", "repo")).rejects.toThrow(
      "Failed to fetch branches",
    );
  });

  test("requestGeneratePr posts payload and parses response", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({
            branchName: "feature/test",
            gitActions: {
              committed: true,
              commitMessage: "feat: test",
              commitSha: "abc123",
              pushed: true,
            },
          }),
        }),
      );
    }) as unknown as typeof fetch;

    const result = await requestGeneratePr({
      sessionId: "session-1",
      sessionTitle: "My session",
      baseBranch: "main",
      branchName: "feature/test",
      commitOnly: true,
    });

    expect(String(fetchCalls[0]?.input)).toBe("/api/generate-pr");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(fetchCalls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(fetchCalls[0]?.init?.body).toBe(
      JSON.stringify({
        sessionId: "session-1",
        sessionTitle: "My session",
        baseBranch: "main",
        branchName: "feature/test",
        commitOnly: true,
      }),
    );

    expect(result.gitActions?.commitMessage).toBe("feat: test");
    expect(result.branchName).toBe("feature/test");
  });

  test("requestGeneratePr throws API error message", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse({
          ok: false,
          status: 400,
          json: async () => ({ error: "Invalid branch" }),
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(
      requestGeneratePr({
        sessionId: "session-1",
        sessionTitle: "My session",
        baseBranch: "main",
        branchName: "bad",
      }),
    ).rejects.toThrow("Invalid branch");
  });

  test("createSessionBranch sets createBranchOnly and returns branch", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({ branchName: "feature/new" }),
        }),
      );
    }) as unknown as typeof fetch;

    const result = await createSessionBranch({
      sessionId: "session-1",
      sessionTitle: "My session",
      baseBranch: "main",
      branchName: "HEAD",
    });

    const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
      createBranchOnly?: boolean;
    };
    expect(body.createBranchOnly).toBe(true);
    expect(result.branchName).toBe("feature/new");
  });

  test("createSessionBranch throws when branchName is missing in response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({}),
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(
      createSessionBranch({
        sessionId: "session-1",
        sessionTitle: "My session",
        baseBranch: "main",
        branchName: "HEAD",
      }),
    ).rejects.toThrow("Failed to determine branch name");
  });

  test("commitAndPushSessionChanges sets commitOnly", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({ gitActions: { pushed: true } }),
        }),
      );
    }) as unknown as typeof fetch;

    const result = await commitAndPushSessionChanges({
      sessionId: "session-1",
      sessionTitle: "My session",
      baseBranch: "main",
      branchName: "feature/test",
      commitTitle: "feat: test",
      commitBody: "details",
    });

    const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
      commitOnly?: boolean;
      commitTitle?: string;
      commitBody?: string;
    };

    expect(body.commitOnly).toBe(true);
    expect(body.commitTitle).toBe("feat: test");
    expect(body.commitBody).toBe("details");
    expect(result.gitActions?.pushed).toBe(true);
  });

  test("generatePullRequestContent passes payload without commit flags", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return Promise.resolve(
        createMockResponse({
          ok: true,
          json: async () => ({ title: "feat: improve flow", body: "Summary" }),
        }),
      );
    }) as unknown as typeof fetch;

    const result = await generatePullRequestContent({
      sessionId: "session-1",
      sessionTitle: "My session",
      baseBranch: "main",
      branchName: "feature/test",
    });

    const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
      commitOnly?: boolean;
      createBranchOnly?: boolean;
    };

    expect(body.commitOnly).toBeUndefined();
    expect(body.createBranchOnly).toBeUndefined();
    expect(result.title).toBe("feat: improve flow");
  });
});
