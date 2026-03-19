import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PullRequestMergeReadiness } from "@/lib/github/client";

type AuthSession = { user: { id: string } } | null;

type SessionRecord = {
  id: string;
  userId: string;
  cloneUrl: string | null;
  repoOwner: string | null;
  repoName: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
};

let authSession: AuthSession = { user: { id: "user-1" } };
let sessionRecord: SessionRecord | null = {
  id: "session-1",
  userId: "user-1",
  cloneUrl: "https://github.com/acme/rocket.git",
  repoOwner: "acme",
  repoName: "rocket",
  prNumber: 42,
  prStatus: "open",
};

const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const mergeCalls: Array<Record<string, unknown>> = [];
const deleteCalls: Array<Record<string, unknown>> = [];

let readinessResult: PullRequestMergeReadiness = {
  success: true,
  canMerge: true,
  reasons: [],
  allowedMethods: ["squash", "merge", "rebase"],
  defaultMethod: "squash",
  checks: {
    requiredTotal: 3,
    passed: 3,
    pending: 0,
    failed: 0,
  },
  pr: {
    number: 42,
    state: "open",
    isDraft: false,
    baseBranch: "main",
    headBranch: "feature/merge-flow",
    headSha: "abc1234",
    headOwner: "acme",
    mergeable: true,
    mergeableState: "clean",
  },
};

let mergeResult: {
  success: boolean;
  sha?: string;
  error?: string;
  statusCode?: number;
} = {
  success: true,
  sha: "def5678",
};

let deleteResult: { success: boolean; error?: string; statusCode?: number } = {
  success: true,
};

function registerRouteMocks() {
  mock.module("@/app/api/sessions/_lib/session-context", () => ({
    requireAuthenticatedUser: async () =>
      authSession
        ? {
            ok: true as const,
            userId: authSession.user.id,
          }
        : {
            ok: false as const,
            response: Response.json(
              { error: "Not authenticated" },
              { status: 401 },
            ),
          },
    requireOwnedSession: async ({
      userId,
      sessionId,
    }: {
      userId: string;
      sessionId: string;
    }) => {
      if (!sessionRecord || sessionRecord.id !== sessionId) {
        return {
          ok: false as const,
          response: Response.json(
            { error: "Session not found" },
            { status: 404 },
          ),
        };
      }

      if (sessionRecord.userId !== userId) {
        return {
          ok: false as const,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        };
      }

      return {
        ok: true as const,
        sessionRecord,
      };
    },
  }));

  mock.module("@/lib/db/sessions", () => ({
    updateSession: async (
      sessionId: string,
      patch: Record<string, unknown>,
    ) => {
      updateCalls.push({ sessionId, patch });
      return sessionRecord ? { ...sessionRecord, ...patch } : null;
    },
  }));

  mock.module("@/lib/github/get-repo-token", () => ({
    getRepoToken: async () => ({ token: "token-123", type: "user" as const }),
  }));

  mock.module("@/lib/github/client", () => ({
    getPullRequestMergeReadiness: async () => readinessResult,
    mergePullRequest: async (input: Record<string, unknown>) => {
      mergeCalls.push(input);
      return mergeResult;
    },
    deleteBranchRef: async (input: Record<string, unknown>) => {
      deleteCalls.push(input);
      return deleteResult;
    },
  }));
}

let routeImportVersion = 0;

async function loadRouteModule() {
  routeImportVersion += 1;
  return import(`./route?test=${routeImportVersion}`);
}

function createContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/merge", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      cloneUrl: "https://github.com/acme/rocket.git",
      repoOwner: "acme",
      repoName: "rocket",
      prNumber: 42,
      prStatus: "open",
    };

    readinessResult = {
      success: true,
      canMerge: true,
      reasons: [],
      allowedMethods: ["squash", "merge", "rebase"],
      defaultMethod: "squash",
      checks: {
        requiredTotal: 3,
        passed: 3,
        pending: 0,
        failed: 0,
      },
      pr: {
        number: 42,
        state: "open",
        isDraft: false,
        baseBranch: "main",
        headBranch: "feature/merge-flow",
        headSha: "abc1234",
        headOwner: "acme",
        mergeable: true,
        mergeableState: "clean",
      },
    };

    mergeResult = { success: true, sha: "def5678" };
    deleteResult = { success: true };
    updateCalls.length = 0;
    mergeCalls.length = 0;
    deleteCalls.length = 0;
    registerRouteMocks();
  });

  test("returns 401 when user is not authenticated", async () => {
    authSession = null;
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/merge", {
        method: "POST",
      }),
      createContext(),
    );

    expect(response.status).toBe(401);
  });

  test("returns 400 when request body is invalid JSON", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
      createContext(),
    );

    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request body");
    expect(mergeCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("returns 409 when pull request is not mergeable", async () => {
    readinessResult = {
      ...readinessResult,
      canMerge: false,
      reasons: ["Required checks are still pending"],
    };

    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mergeMethod: "squash", deleteBranch: true }),
      }),
      createContext(),
    );

    const body = (await response.json()) as {
      error?: string;
      reasons?: string[];
    };

    expect(response.status).toBe(409);
    expect(body.reasons).toEqual(["Required checks are still pending"]);
    expect(mergeCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("merges pull request, deletes branch, and stores merged status", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mergeMethod: "squash",
          deleteBranch: true,
          expectedHeadSha: "abc1234",
        }),
      }),
      createContext(),
    );

    const body = (await response.json()) as {
      merged: boolean;
      prNumber: number;
      mergeCommitSha: string | null;
      branchDeleted: boolean;
      branchDeleteError: string | null;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      merged: true,
      mergeCommitSha: "def5678",
      branchDeleted: true,
      branchDeleteError: null,
      prNumber: 42,
    });

    expect(mergeCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(1);
    expect(updateCalls).toEqual([
      {
        sessionId: "session-1",
        patch: { prStatus: "merged" },
      },
    ]);
  });

  test("does not delete source branch when head owner is unknown", async () => {
    if (!readinessResult.pr) {
      throw new Error("Expected pull request readiness data in test setup");
    }

    readinessResult = {
      ...readinessResult,
      pr: {
        ...readinessResult.pr,
        headOwner: null,
      },
    };

    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mergeMethod: "squash",
          deleteBranch: true,
          expectedHeadSha: "abc1234",
        }),
      }),
      createContext(),
    );

    const body = (await response.json()) as {
      merged: boolean;
      prNumber: number;
      mergeCommitSha: string | null;
      branchDeleted: boolean;
      branchDeleteError: string | null;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      merged: true,
      mergeCommitSha: "def5678",
      branchDeleted: false,
      branchDeleteError:
        "Source branch owner could not be determined; branch was not deleted",
      prNumber: 42,
    });

    expect(mergeCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toEqual([
      {
        sessionId: "session-1",
        patch: { prStatus: "merged" },
      },
    ]);
  });
});
