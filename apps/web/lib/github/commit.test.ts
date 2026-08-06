import { describe, expect, mock, test } from "bun:test";
import type { CommitIntentFile } from "./commit-intent";
import type { CommitOctokit } from "./commit";

mock.module("server-only", () => ({}));

mock.module("./users", () => ({
  getGitHubUserProfile: async () => null,
}));

const { createCommit } = await import("./commit");

type GitApi = CommitOctokit["rest"]["git"];
type GetRefParams = Parameters<GitApi["getRef"]>[0];
type CreateRefParams = Parameters<GitApi["createRef"]>[0];
type GetCommitParams = Parameters<GitApi["getCommit"]>[0];
type CreateBlobParams = Parameters<GitApi["createBlob"]>[0];
type CreateTreeParams = Parameters<GitApi["createTree"]>[0];
type CreateCommitParams = Parameters<GitApi["createCommit"]>[0];
type UpdateRefParams = Parameters<GitApi["updateRef"]>[0];

function createGitHubNotFoundError(): Error & { status: number } {
  return Object.assign(new Error("Not found"), { status: 404 });
}

function getBranchFromRef(ref: string): string {
  return ref.startsWith("heads/") ? ref.slice("heads/".length) : ref;
}

function getBranchFromFullRef(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function createMockOctokit(branchHeads: Map<string, string>) {
  const createRefCalls: CreateRefParams[] = [];
  const getCommitCalls: GetCommitParams[] = [];
  const createTreeCalls: CreateTreeParams[] = [];
  const createCommitCalls: CreateCommitParams[] = [];
  const updateRefCalls: UpdateRefParams[] = [];

  const octokit = {
    rest: {
      git: {
        getRef: async (params: GetRefParams) => {
          const sha = branchHeads.get(getBranchFromRef(params.ref));
          if (!sha) {
            throw createGitHubNotFoundError();
          }
          return { data: { object: { sha } } };
        },
        createRef: async (params: CreateRefParams) => {
          createRefCalls.push(params);
          branchHeads.set(getBranchFromFullRef(params.ref), params.sha);
        },
        getCommit: async (params: GetCommitParams) => {
          getCommitCalls.push(params);
          return { data: { tree: { sha: `tree-${params.commit_sha}` } } };
        },
        createBlob: async (params: CreateBlobParams) => ({
          data: { sha: `blob-${params.content}` },
        }),
        createTree: async (params: CreateTreeParams) => {
          createTreeCalls.push(params);
          return { data: { sha: "tree-sha" } };
        },
        createCommit: async (params: CreateCommitParams) => {
          createCommitCalls.push(params);
          return { data: { sha: "commit-sha" } };
        },
        updateRef: async (params: UpdateRefParams) => {
          updateRefCalls.push(params);
        },
      },
    },
  } satisfies CommitOctokit;

  return {
    octokit,
    createRefCalls,
    getCommitCalls,
    createTreeCalls,
    createCommitCalls,
    updateRefCalls,
  };
}

const files = [
  {
    path: "src/app.ts",
    status: "modified",
    content: "export const value = 1;",
    encoding: "utf-8",
    mode: "100644",
    byteSize: 23,
  },
] satisfies CommitIntentFile[];

describe("createCommit", () => {
  test("creates a missing branch from the captured sandbox HEAD", async () => {
    const mockOctokit = createMockOctokit(
      new Map([["main", "remote-main-sha"]]),
    );

    const result = await createCommit({
      octokit: mockOctokit.octokit,
      owner: "acme",
      repo: "repo",
      branch: "feature",
      baseBranch: "main",
      expectedHeadSha: "local-base-sha",
      message: "test: commit changes",
      files,
    });

    expect(result).toEqual({ ok: true, commitSha: "commit-sha" });
    expect(mockOctokit.createRefCalls[0]?.sha).toBe("local-base-sha");
    expect(mockOctokit.getCommitCalls[0]?.commit_sha).toBe("local-base-sha");
    expect(mockOctokit.createCommitCalls[0]?.parents).toEqual([
      "local-base-sha",
    ]);
  });

  test("rejects existing branches when the remote head changed", async () => {
    const mockOctokit = createMockOctokit(
      new Map([["feature", "remote-feature-sha"]]),
    );

    const result = await createCommit({
      octokit: mockOctokit.octokit,
      owner: "acme",
      repo: "repo",
      branch: "feature",
      expectedHeadSha: "local-feature-sha",
      message: "test: commit changes",
      files,
    });

    expect(result).toEqual({
      ok: false,
      error: "Remote branch changed before commit could be created",
    });
    expect(mockOctokit.createRefCalls).toHaveLength(0);
    expect(mockOctokit.updateRefCalls).toHaveLength(0);
  });
});
