import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  authProvider: "vercel" | "github";
  user: {
    id: string;
  };
} | null;

let authSession: AuthSession;
let vercelToken: string | null;
const fetchMock = mock(async () => new Response(null, { status: 200 }));
const originalFetch = globalThis.fetch;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => vercelToken,
}));

const routeModulePromise = import("./route");

describe("GET /api/vercel/connection-status", () => {
  beforeEach(() => {
    authSession = { authProvider: "vercel", user: { id: "user-1" } };
    vercelToken = "vercel-token";
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("stays connected for non-Vercel sessions", async () => {
    authSession = { authProvider: "github", user: { id: "user-1" } };
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requires reconnect when no usable token is available", async () => {
    vercelToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "token_unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requires reconnect when Vercel rejects the saved token", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "userinfo_auth_failed",
    });
  });

  test("stays connected when validation aborts", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abortError);
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
    });
  });

  test("stays connected when the token validates", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
