import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

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
let hasGitHubLinked = false;
let installations: Array<{ installationId: number }> = [];
let isAdmin = false;

mock.module("server-only", () => ({}));

mock.module("@/lib/session/server", () => ({
  getSessionFromReq: async () => session,
}));

mock.module("@/lib/db/users", () => ({
  userExists: async () => exists,
  isUserAdmin: async () => isAdmin,
}));

mock.module("@/lib/github/token", () => ({
  hasGitHubAccount: async () => hasGitHubLinked,
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
    hasGitHubLinked = false;
    installations = [];
    isAdmin = false;
  });

  test("returns unauthenticated when there is no session", async () => {
    session = null;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  test("returns unauthenticated when the user record is gone", async () => {
    exists = false;
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  test("reports GitHub account and installation state", async () => {
    hasGitHubLinked = true;
    installations = [{ installationId: 1 }];
    const { GET } = await routeModulePromise;

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: session?.user,
      authProvider: "vercel",
      isAdmin: false,
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
      isAdmin: false,
      hasGitHub: false,
      hasGitHubAccount: false,
      hasGitHubInstallations: false,
    });
  });
});
