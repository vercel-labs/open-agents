import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let authSession: { user: { id: string } } | null;
let hasLinkedGitHub = false;
let installations: Array<{ installationId: number }> = [];

mock.module("server-only", () => ({}));

mock.module("arctic", () => ({
  generateState: () => "state-123",
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  hasGitHubAccount: async () => hasLinkedGitHub,
  getUserGitHubToken: async () => (hasLinkedGitHub ? "ghu_test" : null),
  getGitHubUsername: async () => (hasLinkedGitHub ? "testuser" : null),
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => installations,
}));

mock.module("@/lib/github/installations-sync", () => ({
  syncUserInstallations: async () => installations.length,
}));

const routeModulePromise = import("./route");

const originalEnv = {
  NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG,
  NODE_ENV: process.env.NODE_ENV,
};

function createRequest(url: string): NextRequest {
  const nextUrl = new URL(url);

  return {
    url,
    nextUrl,
    cookies: {
      get: () => undefined,
    },
  } as unknown as NextRequest;
}

describe("GET /api/github/app/install", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    hasLinkedGitHub = true;
    installations = [{ installationId: 1 }];

    Object.assign(process.env, {
      NEXT_PUBLIC_GITHUB_APP_SLUG: "open-agents",
      NODE_ENV: "test",
    });
  });

  afterEach(() => {
    Object.assign(process.env, {
      NEXT_PUBLIC_GITHUB_APP_SLUG: originalEnv.NEXT_PUBLIC_GITHUB_APP_SLUG,
      NODE_ENV: originalEnv.NODE_ENV,
    });
  });

  test("redirects to get-started and preserves next when github not linked", async () => {
    hasLinkedGitHub = false;
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest(
        "http://localhost/api/github/app/install?next=/settings/connections",
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.pathname).toBe("/get-started");
    expect(redirectUrl.searchParams.get("next")).toBe("/settings/connections");
  });

  test("redirects to github install when linked but no installations", async () => {
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET(
      createRequest("http://localhost/api/github/app/install?next=/sessions"),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location as string);
    expect(redirectUrl.origin).toBe("https://github.com");
    expect(redirectUrl.pathname).toContain("open-agents");
  });
});
