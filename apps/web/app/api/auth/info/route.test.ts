import { beforeEach, describe, expect, mock, test } from "bun:test";
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
    deletedCookies.length = 0;
  });

  test("returns unauthenticated when there is no session", async () => {
    session = null;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  test("clears the session cookie when the user record is gone", async () => {
    exists = false;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(deletedCookies).toEqual([SESSION_COOKIE_NAME]);
  });

  test("reports GitHub account and installation state", async () => {
    githubAccount = { id: "github-account-1" };
    installations = [{ installationId: 1 }];
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: session?.user,
      authProvider: "vercel",
      hasGitHub: true,
      hasGitHubAccount: true,
      hasGitHubInstallations: true,
    });
  });

  test("reports missing GitHub connection state", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: session?.user,
      authProvider: "vercel",
      hasGitHub: false,
      hasGitHubAccount: false,
      hasGitHubInstallations: false,
    });
  });
});
