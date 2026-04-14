import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { findPullRequestByBranch } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";
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

    // After a branch change the DB was cleared but sessionRecord is stale.
    // Use null when the branch changed so we never return PR info from
    // the previous branch.
    const currentPrNumber = branchChanged ? null : sessionRecord.prNumber;
    const currentPrStatus = branchChanged ? null : sessionRecord.prStatus;

    // 3. Check GitHub for an existing PR on this branch
    const token = await getUserGitHubToken(authResult.userId);
    if (!token) {
      // No token available -- return existing PR info if we have it
      return Response.json({
        branch,
        prNumber: currentPrNumber ?? null,
        prStatus: currentPrStatus ?? null,
      });
    }

    const prResult = await findPullRequestByBranch({
      owner: sessionRecord.repoOwner,
      repo: sessionRecord.repoName,
      branchName: branch,
      token,
    });

    if (prResult.found && prResult.prNumber && prResult.prStatus) {
      // Only update DB if PR info actually changed
      const prChanged =
        prResult.prNumber !== currentPrNumber ||
        prResult.prStatus !== currentPrStatus;

      if (prChanged) {
        await updateSession(sessionId, {
          prNumber: prResult.prNumber,
          prStatus: prResult.prStatus,
        });
      }

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
