"use server";

import { connectSandbox } from "@open-agents/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  findPullRequest,
  getMergeReadiness as fetchMergeReadiness,
  type CheckRun,
  type MergeMethod,
} from "@/lib/github/pulls";
import { getUserGitHubToken } from "@/lib/github/token";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// ---- types ----

type MergeReadinessChecks = {
  requiredTotal: number;
  passed: number;
  pending: number;
  failed: number;
};

export type MergeReadinessResponse = {
  canMerge: boolean;
  reasons: string[];
  pr: {
    number: number;
    repo: string;
    title: string | null;
    body: string | null;
    baseBranch: string | null;
    headBranch: string | null;
    headSha: string | null;
    additions: number;
    deletions: number;
    changedFiles: number;
    commits: number;
  } | null;
  allowedMethods: MergeMethod[];
  defaultMethod: MergeMethod;
  checks: MergeReadinessChecks;
  checkRuns: CheckRun[];
};

// ---- helpers ----

async function requireAuth() {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }
  return session;
}

async function requireOwnedSession(userId: string, sessionId: string) {
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== userId) {
    throw new Error("Forbidden");
  }
  return sessionRecord;
}

const DEFAULT_CHECKS: MergeReadinessChecks = {
  requiredTotal: 0,
  passed: 0,
  pending: 0,
  failed: 0,
};

const DEFAULT_METHOD: MergeMethod = "squash";

function buildUnavailableResponse(
  reason: string,
  prNumber: number | null,
  repo: string | null,
): MergeReadinessResponse {
  return {
    canMerge: false,
    reasons: [reason],
    pr:
      prNumber && repo
        ? {
            number: prNumber,
            repo,
            title: null,
            body: null,
            baseBranch: null,
            headBranch: null,
            headSha: null,
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            commits: 0,
          }
        : null,
    allowedMethods: [DEFAULT_METHOD],
    defaultMethod: DEFAULT_METHOD,
    checks: DEFAULT_CHECKS,
    checkRuns: [],
  };
}

// ---- server actions ----

export async function checkPullRequest(params: { sessionId: string }): Promise<{
  branch: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
}> {
  const { sessionId } = params;

  const session = await requireAuth();
  const sessionRecord = await requireOwnedSession(session.user.id, sessionId);

  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return {
      branch: sessionRecord.branch ?? null,
      prNumber: sessionRecord.prNumber ?? null,
      prStatus: sessionRecord.prStatus ?? null,
    };
  }

  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    throw new Error("Sandbox not active");
  }

  if (!sessionRecord.repoOwner || !sessionRecord.repoName) {
    throw new Error("No repo info on session");
  }

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

  // if we cannot determine the branch (detached HEAD), clear stale PR metadata
  if (!branch) {
    if (sessionRecord.prNumber || sessionRecord.prStatus) {
      await updateSession(sessionId, { prNumber: null, prStatus: null });
    }
    return { branch: null, prNumber: null, prStatus: null };
  }

  // persist the branch if it changed; clear existing PR metadata for previous branch
  const branchChanged = branch !== sessionRecord.branch;
  if (branchChanged) {
    await updateSession(sessionId, {
      branch,
      ...(sessionRecord.prNumber || sessionRecord.prStatus
        ? { prNumber: null, prStatus: null }
        : {}),
    });
  }

  // after a branch change the DB was cleared but sessionRecord is stale
  const currentPrNumber = branchChanged ? null : sessionRecord.prNumber;
  const currentPrStatus = branchChanged ? null : sessionRecord.prStatus;

  // check GitHub for an existing PR on this branch
  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    return {
      branch,
      prNumber: currentPrNumber ?? null,
      prStatus: (currentPrStatus as "open" | "merged" | "closed") ?? null,
    };
  }

  const prResult = await findPullRequest({
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
    branchName: branch,
    token,
  });

  if (prResult.found && prResult.prNumber && prResult.prStatus) {
    const prChanged =
      prResult.prNumber !== currentPrNumber ||
      prResult.prStatus !== currentPrStatus;

    if (prChanged) {
      await updateSession(sessionId, {
        prNumber: prResult.prNumber,
        prStatus: prResult.prStatus,
      });
    }

    return {
      branch,
      prNumber: prResult.prNumber,
      prStatus: prResult.prStatus as "open" | "merged" | "closed",
    };
  }

  return { branch, prNumber: null, prStatus: null };
}

export async function getMergeReadiness(params: {
  sessionId: string;
}): Promise<MergeReadinessResponse> {
  const { sessionId } = params;

  const session = await requireAuth();
  const sessionRecord = await requireOwnedSession(session.user.id, sessionId);

  const repoIdentifier =
    sessionRecord.repoOwner && sessionRecord.repoName
      ? `${sessionRecord.repoOwner}/${sessionRecord.repoName}`
      : null;

  if (!sessionRecord.cloneUrl || !repoIdentifier || !sessionRecord.repoOwner) {
    return buildUnavailableResponse(
      "Session is not linked to a GitHub repository",
      sessionRecord.prNumber,
      repoIdentifier,
    );
  }

  if (!sessionRecord.prNumber) {
    return buildUnavailableResponse(
      "No pull request found for this session",
      null,
      repoIdentifier,
    );
  }

  if (sessionRecord.prStatus === "merged") {
    return buildUnavailableResponse(
      "Pull request is already merged",
      sessionRecord.prNumber,
      repoIdentifier,
    );
  }

  if (sessionRecord.prStatus === "closed") {
    return buildUnavailableResponse(
      "Pull request is closed",
      sessionRecord.prNumber,
      repoIdentifier,
    );
  }

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    return buildUnavailableResponse(
      "No GitHub token available for this repository",
      sessionRecord.prNumber,
      repoIdentifier,
    );
  }

  const readiness = await fetchMergeReadiness({
    repoUrl: sessionRecord.cloneUrl,
    prNumber: sessionRecord.prNumber,
    token,
  });

  const allowedMethods =
    readiness.allowedMethods.length > 0
      ? readiness.allowedMethods
      : [DEFAULT_METHOD];

  const defaultMethod = allowedMethods.includes(readiness.defaultMethod)
    ? readiness.defaultMethod
    : (allowedMethods[0] ?? DEFAULT_METHOD);

  return {
    canMerge: readiness.canMerge,
    reasons:
      readiness.reasons.length > 0
        ? readiness.reasons
        : readiness.success
          ? []
          : [readiness.error ?? "Failed to check pull request readiness"],
    pr: {
      number: sessionRecord.prNumber,
      repo: repoIdentifier,
      title: readiness.pr?.title ?? null,
      body: readiness.pr?.body ?? null,
      baseBranch: readiness.pr?.baseBranch ?? null,
      headBranch: readiness.pr?.headBranch ?? null,
      headSha: readiness.pr?.headSha ?? null,
      additions: readiness.pr?.additions ?? 0,
      deletions: readiness.pr?.deletions ?? 0,
      changedFiles: readiness.pr?.changedFiles ?? 0,
      commits: readiness.pr?.commits ?? 0,
    },
    allowedMethods,
    defaultMethod,
    checks: readiness.checks,
    checkRuns: readiness.checkRuns ?? [],
  };
}
