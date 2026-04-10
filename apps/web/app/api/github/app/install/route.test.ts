import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let authSession: { user: { id: string } } | null;
let githubAccount: { externalUserId: string } | null;
let installations: Array<{ installationId: number }>;

mock.module("arctic", () => ({
  generateState: () => "state-123",
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/db/accounts", () => ({
  getGitHubAccount: async () => githubAccount,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => installations,
}));

mock.module("@/lib/crypto", () => ({
  decrypt: () => "ghu_saved",
}));

mock.module("@/lib/github/installations-sync", () => ({
  syncUserInstallations: async () => installations.length,
}));

const routeModulePromise = import("./route");

const originalEnv = {
  NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG,
  NEXT_PUBLIC_GITHUB_CLIENT_ID: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
  NODE_ENV: process.env.NODE_ENV,
};

function createRequest(
  url: string,
  cookieValues: Record<string, string> = {},
): NextRequest {
  const nextUrl = new URL(url);

  return {
    url,
    nextUrl,
    cookies: {
      get: (name: string) => {
        const value = cookieValues[name];
        return value ? { value } : undefined;
      },
    },
  } as NextRequest;
}

describe("GET /api/github/app/install", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    githubAccount = { externalUserId: "123" };
    installations = [{ installationId: 1 }];

    Object.assign(process.env, {
      NEXT_PUBLIC_GITHUB_APP_SLUG: "open-harness",
      NEXT_PUBLIC_GITHUB_CLIENT_ID: "client-id",
      NODE_ENV: "test",
    });
  });

  afterEach(() => {
    Object.assign(process.env, {
      NEXT_PUBLIC_GITHUB_APP_SLUG: originalEnv.NEXT_PUBLIC_GITHUB_APP_SLUG,
      NEXT_PUBLIC_GITHUB_CLIENT_ID: originalEnv.NEXT_PUBLIC_GITHUB_CLIENT_ID,
      NODE_ENV: originalEnv.NODE_ENV,
    });
  });

  test("forces OAuth when reconnect mode is active", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest("http://localhost/api/github/app/install?next=/sessions", {
        github_reconnect: "1",
      }),
    );

    expect(response.status).toBe(307);

    const location = response.headers.get("location");
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location as string);
    expect(redirectUrl.origin).toBe("https://github.com");
    expect(redirectUrl.pathname).toBe("/login/oauth/authorize");
    expect(redirectUrl.searchParams.get("client_id")).toBe("client-id");
    expect(redirectUrl.searchParams.get("state")).toBe("state-123");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/github/app/callback",
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("github_app_install_redirect_to=%2Fsessions");
    expect(setCookie).toContain("github_app_install_state=state-123");
  });
});
