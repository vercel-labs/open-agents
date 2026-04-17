import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";

const deletedCookies: string[] = [];

type TestSession = {
  authProvider: "vercel" | "github";
  user: {
    id: string;
    username: string;
    email?: string;
    avatar: string;
  };
} | null;

let session: TestSession;
let exists = true;
let githubAccount: { id: string } | null = null;
let installations: Array<{ installationId: number }> = [];
let vercelToken: string | null = null;
const fetchMock = mock(async () => new Response(null, { status: 200 }));
const originalFetch = globalThis.fetch;

mock.module("next/headers", () => ({
  cookies: async () => ({
    delete: (name: string) => {
      deletedCookies.push(name);
    },
  }),
}));

mock.module("@/lib/session/server", () => ({
  getSessionFromReq: async () => session,
}));

mock.module("@/lib/db/users", () => ({
  userExists: async () => exists,
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => githubAccount,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => installations,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => vercelToken,
}));

const routeModulePromise = import("./route");

function createRequest(): NextRequest {
  return {
    nextUrl: new URL("http://localhost/api/auth/info"),
    url: "http://localhost/api/auth/info",
  } as NextRequest;
}

describe("GET /api/auth/info", () => {
  beforeEach(() => {
    session = {
      authProvider: "vercel",
      user: {
        id: "user-1",
        username: "vercel-user",
        email: "person@example.com",
        avatar: "https://example.com/avatar.png",
      },
    };
    exists = true;
    githubAccount = null;
    installations = [];
    vercelToken = "vercel-token";
    deletedCookies.length = 0;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns unauthenticated when there is no session", async () => {
    session = null;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("clears the session cookie when the user record is gone", async () => {
    exists = false;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(deletedCookies).toEqual([SESSION_COOKIE_NAME]);
  });

  test("flags reconnect when the Vercel token is unavailable", async () => {
    vercelToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authProvider: "vercel",
      vercelReconnectRequired: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("flags reconnect when Vercel rejects the saved token", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authProvider: "vercel",
      vercelReconnectRequired: true,
    });
  });

  test("keeps Vercel sessions connected when validation aborts", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abortError);
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authProvider: "vercel",
      vercelReconnectRequired: false,
    });
  });

  test("keeps Vercel sessions connected when the token validates", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authProvider: "vercel",
      vercelReconnectRequired: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
