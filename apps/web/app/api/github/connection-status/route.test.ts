import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
  };
} | null;

let authSession: AuthSession;
let hasLinkedGitHub = false;
let installations: Array<{ installationId: number }>;
let userToken: string | null;
let githubUsername: string | null;
let syncedInstallationsCount = 0;
let syncError: Error | null;
let syncErrorIsAuth = false;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/github/token", () => ({
  hasGitHubAccount: async () => hasLinkedGitHub,
  getUserGitHubToken: async () => userToken,
  getGitHubUsername: async () => githubUsername,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => installations,
}));

mock.module("@/lib/github/installations-sync", () => ({
  syncUserInstallations: async () => {
    if (syncError) {
      throw syncError;
    }

    return syncedInstallationsCount;
  },
  isGitHubInstallationsAuthError: () => syncErrorIsAuth,
}));

const routeModulePromise = import("./route");

describe("GET /api/github/connection-status", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    hasLinkedGitHub = true;
    installations = [{ installationId: 1 }];
    userToken = "ghu_user";
    githubUsername = "octocat";
    syncedInstallationsCount = 1;
    syncError = null;
    syncErrorIsAuth = false;
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  test("returns not_connected when no GitHub account is linked", async () => {
    hasLinkedGitHub = false;
    installations = [];
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "not_connected",
      reason: null,
      hasInstallations: false,
      syncedInstallationsCount: 0,
    });
  });

  test("requires reconnect when no usable token is available", async () => {
    userToken = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: true,
      syncedInstallationsCount: null,
    });
  });

  test("requires reconnect when live sync drops cached installations to zero", async () => {
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "installations_missing",
      hasInstallations: false,
      syncedInstallationsCount: 0,
    });
  });

  test("stays connected when sync succeeds with installations", async () => {
    syncedInstallationsCount = 2;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
      hasInstallations: true,
      syncedInstallationsCount: 2,
    });
  });

  test("stays connected when the account has no installations yet", async () => {
    installations = [];
    syncedInstallationsCount = 0;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "connected",
      reason: null,
      hasInstallations: false,
      syncedInstallationsCount: 0,
    });
  });

  test("requires reconnect when GitHub rejects installation sync auth", async () => {
    syncError = new Error("GitHub auth failed");
    syncErrorIsAuth = true;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reconnect_required",
      reason: "sync_auth_failed",
      hasInstallations: true,
      syncedInstallationsCount: null,
    });
  });
});
