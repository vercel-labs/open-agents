import type { CommitIntentFile, GitTreeFileMode } from "./commit-intent";
import { getGitHubUserProfile } from "./users";

export interface GitIdentity {
  name: string;
  email: string;
}

export interface CommitParams {
  octokit: CommitOctokit;
  owner: string;
  repo: string;
  branch: string;
  /** fallback branch when target branch doesn't exist on remote yet */
  baseBranch?: string;
  /** sandbox HEAD SHA captured before building the commit bundle */
  expectedHeadSha?: string;
  message: string;
  files: CommitIntentFile[];
  /** user identity appended as co-authored-by trailer */
  coAuthor?: GitIdentity;
}

export type CommitResult =
  | { ok: true; commitSha: string }
  | { ok: false; error: string };

export function buildCommitMessageWithCoAuthor(
  message: string,
  coAuthor?: GitIdentity,
): string {
  return coAuthor
    ? `${message}\n\nCo-Authored-By: ${coAuthor.name} <${coAuthor.email}>`
    : message;
}

type GitTreeEntry = {
  path: string;
  mode: GitTreeFileMode;
  type: "blob";
  sha: string | null;
};

export interface CommitOctokit {
  rest: {
    git: {
      getRef(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: { object: { sha: string } } }>;
      createRef(params: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
      }): Promise<unknown>;
      getCommit(params: {
        owner: string;
        repo: string;
        commit_sha: string;
      }): Promise<{ data: { tree: { sha: string } } }>;
      createBlob(params: {
        owner: string;
        repo: string;
        content: string;
        encoding: "utf-8" | "base64";
      }): Promise<{ data: { sha: string } }>;
      createTree(params: {
        owner: string;
        repo: string;
        base_tree: string;
        tree: GitTreeEntry[];
      }): Promise<{ data: { sha: string } }>;
      createCommit(params: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }): Promise<{ data: { sha: string } }>;
      updateRef(params: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
        force: boolean;
      }): Promise<unknown>;
    };
  };
}

function getGitHubHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  return null;
}

async function getBranchHead(
  octokit: CommitOctokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  try {
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return ref.object.sha;
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    if (status === 404) return null;
    throw error;
  }
}

/**
 * Create a verified commit via the GitHub Git Data API.
 * Commits created with a GitHub App installation token are
 * automatically signed and show as "Verified" on GitHub.
 */
export async function createCommit(
  params: CommitParams,
): Promise<CommitResult> {
  const {
    octokit,
    owner,
    repo,
    branch,
    baseBranch,
    expectedHeadSha,
    message,
    files,
    coAuthor,
  } = params;

  const additions = files.filter((f) => f.status !== "deleted");
  const deletions = files.filter((f) => f.status === "deleted");

  if (additions.length === 0 && deletions.length === 0) {
    return { ok: false, error: "No changes to commit" };
  }

  try {
    // 1. resolve parent commit
    let headSha = await getBranchHead(octokit, owner, repo, branch);
    let branchIsNew = false;

    if (!headSha) {
      if (!baseBranch && !expectedHeadSha) {
        return {
          ok: false,
          error: `Branch '${branch}' not found on remote. Pass baseBranch to create it.`,
        };
      }

      headSha = expectedHeadSha ?? null;
      if (!headSha && baseBranch) {
        headSha = await getBranchHead(octokit, owner, repo, baseBranch);
      }
      if (!headSha) {
        return {
          ok: false,
          error: `Base branch '${baseBranch}' not found on remote`,
        };
      }

      // create the branch now so updateRef works later
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: headSha,
      });
      branchIsNew = true;
    }

    if (!branchIsNew && expectedHeadSha && headSha !== expectedHeadSha) {
      return {
        ok: false,
        error: "Remote branch changed before commit could be created",
      };
    }

    // 2. get base tree
    const { data: parentCommit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: headSha,
    });

    // 3. create blobs
    const blobShas = new Map<string, string>();
    const BATCH = 10;

    for (let i = 0; i < additions.length; i += BATCH) {
      const batch = additions.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (file) => {
          const { data } = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: file.content,
            encoding: file.encoding,
          });
          return { path: file.path, sha: data.sha };
        }),
      );
      for (const { path, sha } of results) {
        blobShas.set(path, sha);
      }
    }

    // 4. build tree
    const treeEntries: GitTreeEntry[] = [];

    for (const file of additions) {
      const sha = blobShas.get(file.path);
      if (!sha) continue;
      treeEntries.push({
        path: file.path,
        mode: file.mode,
        type: "blob",
        sha,
      });
    }

    for (const file of deletions) {
      treeEntries.push({
        path: file.path,
        mode: file.mode,
        type: "blob",
        sha: null,
      });
    }

    // renamed files: delete old path
    for (const file of files) {
      if (file.status === "renamed" && file.oldPath) {
        treeEntries.push({
          path: file.oldPath,
          mode: file.mode,
          type: "blob",
          sha: null,
        });
      }
    }

    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: parentCommit.tree.sha,
      tree: treeEntries,
    });

    // 5. create commit — omit author/committer so github auto-signs
    const fullMessage = buildCommitMessageWithCoAuthor(message, coAuthor);
    // with the app's bot identity (per github docs, custom author/committer
    // info disables automatic signature verification for bots)
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: fullMessage,
      tree: tree.sha,
      parents: [headSha],
    });

    // 6. update branch ref
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: branchIsNew,
    });

    return { ok: true, commitSha: commit.sha };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error creating commit";
    console.error("[commit] Failed:", error);
    return { ok: false, error: errorMessage };
  }
}

/**
 * Build the user identity for co-authored-by attribution.
 */
export async function buildCoAuthor(
  userId: string,
): Promise<GitIdentity | null> {
  const profile = await getGitHubUserProfile(userId);
  if (!profile) return null;

  return {
    name: profile.username,
    email: `${profile.externalUserId}+${profile.username}@users.noreply.github.com`,
  };
}
