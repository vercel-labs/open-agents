import type { Octokit } from "@octokit/rest";
import type { FileWithContent } from "@open-agents/sandbox";
import { getGitHubUserProfile } from "./users";

export interface GitIdentity {
  name: string;
  email: string;
}

export interface CommitParams {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  /** fallback branch when target branch doesn't exist on remote yet */
  baseBranch?: string;
  message: string;
  files: FileWithContent[];
  /** user identity appended as co-authored-by trailer */
  coAuthor?: GitIdentity;
}

export type CommitResult =
  | { ok: true; commitSha: string }
  | { ok: false; error: string };

async function getBranchHead(
  octokit: Octokit,
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
    const status = (error as { status?: number }).status;
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
  const { octokit, owner, repo, branch, baseBranch, message, files, coAuthor } =
    params;

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
      if (!baseBranch) {
        return {
          ok: false,
          error: `Branch '${branch}' not found on remote. Pass baseBranch to create it.`,
        };
      }

      headSha = await getBranchHead(octokit, owner, repo, baseBranch);
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
    const treeEntries = [];

    for (const file of additions) {
      const sha = blobShas.get(file.path);
      if (!sha) continue;
      treeEntries.push({
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha,
      });
    }

    for (const file of deletions) {
      treeEntries.push({
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: null,
      });
    }

    // renamed files: delete old path
    for (const file of files) {
      if (file.status === "renamed" && file.oldPath) {
        treeEntries.push({
          path: file.oldPath,
          mode: "100644" as const,
          type: "blob" as const,
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
    const fullMessage = coAuthor
      ? `${message}\n\nCo-Authored-By: ${coAuthor.name} <${coAuthor.email}>`
      : message;
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
