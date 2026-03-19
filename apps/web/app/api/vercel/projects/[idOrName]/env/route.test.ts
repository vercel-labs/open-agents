import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};
let currentToken: string | null = "vercel-token";
const fetchCalls: Array<{ url: string; headers: HeadersInit | undefined }> = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => currentToken,
}));

const originalFetch = globalThis.fetch;
const routeModulePromise = import("./route");

describe("/api/vercel/projects/[idOrName]/env", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    currentToken = "vercel-token";
    fetchCalls.length = 0;
    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: input.toString(), headers: init?.headers });
        return new Response('{"envs":[]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("uses the stored user token to proxy the upstream Vercel env request", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/vercel/projects/demo/env?teamId=team-1&decrypt=true",
      ),
      {
        params: Promise.resolve({ idOrName: "demo" }),
      },
    );

    expect(response.status).toBe(200);
    expect(fetchCalls).toEqual([
      {
        url: "https://api.vercel.com/v10/projects/demo/env?teamId=team-1&decrypt=true",
        headers: {
          Authorization: "Bearer vercel-token",
          Accept: "application/json",
        },
      },
    ]);
    expect(await response.json()).toEqual({ envs: [] });
  });

  test("preserves upstream status and body for debugging failures", async () => {
    const { GET } = await routeModulePromise;

    globalThis.fetch = mock(
      async () =>
        new Response('{"error":{"message":"forbidden"}}', {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const response = await GET(
      new Request("http://localhost/api/vercel/projects/demo/env"),
      {
        params: Promise.resolve({ idOrName: "demo" }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: "forbidden" },
    });
  });
});
