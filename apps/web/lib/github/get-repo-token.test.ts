import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let directInstallationMatch:
  | { installationId: number; accountLogin: string }
  | undefined;
let fallbackInstallations: Array<{
  installationId: number;
  accountLogin: string;
}> = [];
let installationToken = "ghs_installation";
let userToken: string | null = null;

const getInstallationByAccountLoginSpy = mock(
  async () => directInstallationMatch,
);
const getInstallationsByUserIdSpy = mock(async () => fallbackInstallations);
const getInstallationTokenSpy = mock(async () => installationToken);
const getUserGitHubTokenSpy = mock(async (_userId?: string) => userToken);

mock.module("@/lib/db/installations", () => ({
  getInstallationByAccountLogin: getInstallationByAccountLoginSpy,
  getInstallationsByUserId: getInstallationsByUserIdSpy,
}));

mock.module("@/lib/github/app-auth", () => ({
  getInstallationToken: getInstallationTokenSpy,
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: getUserGitHubTokenSpy,
}));

const modulePromise = import("./get-repo-token");

describe("getRepoToken", () => {
  beforeEach(() => {
    directInstallationMatch = undefined;
    fallbackInstallations = [];
    installationToken = "ghs_installation";
    userToken = null;

    getInstallationByAccountLoginSpy.mockClear();
    getInstallationsByUserIdSpy.mockClear();
    getInstallationTokenSpy.mockClear();
    getUserGitHubTokenSpy.mockClear();
  });

  test("returns an installation token when a matching installation exists", async () => {
    const { getRepoToken } = await modulePromise;
    directInstallationMatch = {
      installationId: 42,
      accountLogin: "acme",
    };

    const result = await getRepoToken("user-1", "acme");

    expect(result).toEqual({
      token: "ghs_installation",
      type: "installation",
      installationId: 42,
    });
    expect(getUserGitHubTokenSpy).not.toHaveBeenCalled();
  });

  test("falls back to the explicit user id when only a user token is available", async () => {
    const { getRepoToken } = await modulePromise;
    userToken = "ghu_user";

    const result = await getRepoToken("user-1", "acme");

    expect(result).toEqual({ token: "ghu_user", type: "user" });
    expect(getUserGitHubTokenSpy).toHaveBeenCalledWith("user-1");
  });
});
