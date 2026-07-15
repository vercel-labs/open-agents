import { beforeEach, describe, expect, mock, test } from "bun:test";

class MockConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockConnectError";
  }
}

let accountRows: Array<{ accountId: string }>;
let getTokenError: Error | null;

const getTokenSpy = mock(
  async (_connector: string, _params: Record<string, unknown>) => {
    if (getTokenError) {
      throw getTokenError;
    }
    return "ghu_test";
  },
);
const revokeTokenSpy = mock(
  async (_connector: string, _params: Record<string, unknown>) => {},
);
const deleteTokenCacheEntrySpy = mock(
  (_connector: string, _params: Record<string, unknown>) => {},
);

mock.module("server-only", () => ({}));

mock.module("@vercel/connect", () => ({
  getToken: getTokenSpy,
  revokeToken: revokeTokenSpy,
  deleteTokenCacheEntry: deleteTokenCacheEntrySpy,
  UserAuthorizationRequiredError: MockConnectError,
  NoValidTokenError: MockConnectError,
}));

mock.module("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => accountRows,
        }),
      }),
    }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  accounts: {
    accountId: "accountId",
    userId: "userId",
    providerId: "providerId",
  },
}));

process.env.GITHUB_CONNECTOR = "github/test-connector";

const tokenModulePromise = import("./token");

beforeEach(() => {
  getTokenSpy.mockClear();
  revokeTokenSpy.mockClear();
  deleteTokenCacheEntrySpy.mockClear();
  accountRows = [{ accountId: "connect-sub-1" }];
  getTokenError = null;
});

describe("getUserGitHubToken", () => {
  test("exchanges the stored Connect subject id for a GitHub token", async () => {
    const { getUserGitHubToken } = await tokenModulePromise;

    const token = await getUserGitHubToken("user-1");

    expect(token).toBe("ghu_test");
    expect(getTokenSpy).toHaveBeenCalledTimes(1);
    expect(getTokenSpy.mock.calls[0]?.[0]).toBe("github/test-connector");
    expect(getTokenSpy.mock.calls[0]?.[1]).toEqual({
      subject: { type: "user", id: "connect-sub-1" },
    });
  });

  test("returns null when the user has no linked GitHub account", async () => {
    const { getUserGitHubToken } = await tokenModulePromise;
    accountRows = [];

    const token = await getUserGitHubToken("user-1");

    expect(token).toBeNull();
    expect(getTokenSpy).not.toHaveBeenCalled();
  });

  test("returns null when the user has not authorized the connector", async () => {
    const { getUserGitHubToken } = await tokenModulePromise;
    getTokenError = new MockConnectError("not authorized");

    const token = await getUserGitHubToken("user-1");

    expect(token).toBeNull();
  });

  test("returns null when the grant was revoked", async () => {
    const { getUserGitHubToken } = await tokenModulePromise;
    getTokenError = new MockConnectError("revoked");

    const token = await getUserGitHubToken("user-1");

    expect(token).toBeNull();
  });

  test("returns null on unexpected errors", async () => {
    const { getUserGitHubToken } = await tokenModulePromise;
    getTokenError = new Error("boom");

    const token = await getUserGitHubToken("user-1");

    expect(token).toBeNull();
  });
});

describe("getGitHubAppUserToken", () => {
  test("aliases getUserGitHubToken", async () => {
    const { getGitHubAppUserToken } = await tokenModulePromise;

    const token = await getGitHubAppUserToken("user-1");

    expect(token).toBe("ghu_test");
  });
});

describe("revokeUserGitHubGrant", () => {
  test("revokes the grant and clears the cached token", async () => {
    const { revokeUserGitHubGrant } = await tokenModulePromise;

    const revoked = await revokeUserGitHubGrant("user-1");

    expect(revoked).toBe(true);
    expect(revokeTokenSpy).toHaveBeenCalledTimes(1);
    expect(revokeTokenSpy.mock.calls[0]?.[1]).toEqual({
      subject: { type: "user", id: "connect-sub-1" },
    });
    expect(deleteTokenCacheEntrySpy).toHaveBeenCalledTimes(1);
  });

  test("returns false when the user has no linked GitHub account", async () => {
    const { revokeUserGitHubGrant } = await tokenModulePromise;
    accountRows = [];

    const revoked = await revokeUserGitHubGrant("user-1");

    expect(revoked).toBe(false);
    expect(revokeTokenSpy).not.toHaveBeenCalled();
  });
});
