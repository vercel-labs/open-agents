import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { findPullRequestByBranch } from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { isSandboxActive } from "@/lib/sandbox/utils";

interface CheckPrRequest {
  sessionId: string;
}

/**
 * POST /api/check-pr
 *
 * Checks the current branch in the sandbox, looks for an existing PR on that
 * branch, and persists the branch + PR info to the session record.
 *
 * Called automatically after each agent message completes and on session entry
 * once sandbox connectivity is established.
 */
export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: CheckPrRequest;
  try {
    body = (await req.json()) as CheckPrRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;
  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Sandbox not active",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not active" }, { status: 400 });
  }

  // Need an active sandbox to check branch, and repo info to check PRs
  if (!sessionRecord.repoOwner || !sessionRecord.repoName) {
    return Response.json({ error: "No repo info on session" }, { status: 400 });
  }

  try {
    // 1. Get current branch from sandbox
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;
    const symbolicRefResult = await sandbox.exec(
      "git symbolic-ref --short HEAD",
      cwd,
      10000,
    );

    let branch: string | null = null;
    if (symbolicRefResult.success && symbolicRefResult.stdout.trim()) {
      branch = symbolicRefResult.stdout.trim();
    }

    // If we cannot determine the branch (detached HEAD), clear any stale PR
    // metadata because it may belong to a previously checked branch.
    if (!branch) {
      if (sessionRecord.prNumber || sessionRecord.prStatus) {
        await updateSession(sessionId, { prNumber: null, prStatus: null });
      }
      return Response.json({ branch: null, prNumber: null, prStatus: null });
    }

    // 2. Persist the branch to the session if it changed. If the branch changed,
    // clear any existing PR metadata because it belongs to the previous branch.
    const branchChanged = branch !== sessionRecord.branch;
    if (branchChanged) {
      await updateSession(sessionId, {
        branch,
        ...(sessionRecord.prNumber || sessionRecord.prStatus
          ? { prNumber: null, prStatus: null }
          : {}),
      });
    }

    // 3. If session already has a PR recorded for the same branch, just return
    // current state (the PR was created through our flow -- no need to re-check)
    if (!branchChanged && sessionRecord.prNumber) {
      return Response.json({
        branch,
        prNumber: sessionRecord.prNumber,
        prStatus: sessionRecord.prStatus,
      });
    }

    // 4. Check GitHub for an existing PR on this branch
    let token: string | undefined;
    try {
      const tokenResult = await getRepoToken(
        authResult.userId,
        sessionRecord.repoOwner,
      );
      token = tokenResult.token;
    } catch {
      // No token available -- skip PR check
      return Response.json({ branch, prNumber: null, prStatus: null });
    }

    const prResult = await findPullRequestByBranch({
      owner: sessionRecord.repoOwner,
      repo: sessionRecord.repoName,
      branchName: branch,
      token,
    });

    if (prResult.found && prResult.prNumber && prResult.prStatus) {
      // Persist PR info to session
      await updateSession(sessionId, {
        prNumber: prResult.prNumber,
        prStatus: prResult.prStatus,
      });

      return Response.json({
        branch,
        prNumber: prResult.prNumber,
        prStatus: prResult.prStatus,
      });
    }

    return Response.json({ branch, prNumber: null, prStatus: null });
  } catch (error) {
    console.error("Failed to check PR status:", error);
    return Response.json(
      { error: "Failed to check PR status" },
      { status: 500 },
    );
  }
}
