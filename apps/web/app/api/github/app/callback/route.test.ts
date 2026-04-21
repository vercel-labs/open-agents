import { beforeEach, describe, expect, mock, test } from "bun:test";

let authSession: { user: { id: string } } | null;
let cookieValues: Record<string, string>;
let githubToken: string | null;
let githubUsername: string | null;
let syncedInstallationsCount = 0;
let syncInstallationsError: Error | null;

mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues[name];
      return value ? { value } : undefined;
    },
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: async () => githubToken,
  getGitHubUsername: async () => githubUsername,
}));

mock.module("@/lib/github/installations-sync", () => ({
  syncUserInstallations: async () => {
    if (syncInstallationsError) {
      throw syncInstallationsError;
    }

    return syncedInstallationsCount;
  },
}));

const routeModulePromise = import("./route");

function getRedirectUrl(response: Response): URL {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location as string);
}

describe("GET /api/github/app/callback", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    cookieValues = {
      github_app_install_redirect_to: "/settings/connections",
    };
    githubToken = "ghu_test";
    githubUsername = "octocat";
    syncedInstallationsCount = 1;
    syncInstallationsError = null;
  });

  test("returns no_action when the user exits before selecting an installation", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/github/app/callback"),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/settings/connections");
    expect(redirectUrl.searchParams.get("github")).toBe("no_action");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBe("1");
  });

  test("returns pending_sync when github reports an installation but sync is still empty", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("pending_sync");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBeNull();
  });

  test("returns connected only after at least one installation syncs", async () => {
    syncedInstallationsCount = 1;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/app/callback?installation_id=123",
      ),
    );

    expect(response.status).toBe(307);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("github")).toBe("connected");
    expect(redirectUrl.searchParams.get("missing_installation_id")).toBeNull();
  });
});
