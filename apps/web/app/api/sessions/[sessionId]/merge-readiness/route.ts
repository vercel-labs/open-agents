import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  getPullRequestMergeReadiness,
  type PullRequestCheckRun,
  type PullRequestMergeMethod,
} from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type MergeReadinessChecks = {
  requiredTotal: number;
  passed: number;
  pending: number;
  failed: number;
};

const DEFAULT_CHECKS: MergeReadinessChecks = {
  requiredTotal: 0,
  passed: 0,
  pending: 0,
  failed: 0,
};

const DEFAULT_METHOD: PullRequestMergeMethod = "squash";

export type MergeReadinessResponse = {
  canMerge: boolean;
  reasons: string[];
  pr: {
    number: number;
    repo: string;
    baseBranch: string | null;
    headBranch: string | null;
    headSha: string | null;
  } | null;
  allowedMethods: PullRequestMergeMethod[];
  defaultMethod: PullRequestMergeMethod;
  checks: MergeReadinessChecks;
  checkRuns: PullRequestCheckRun[];
};

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
            baseBranch: null,
            headBranch: null,
            headSha: null,
          }
        : null,
    allowedMethods: [DEFAULT_METHOD],
    defaultMethod: DEFAULT_METHOD,
    checks: DEFAULT_CHECKS,
    checkRuns: [],
  };
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  const repoIdentifier =
    sessionRecord.repoOwner && sessionRecord.repoName
      ? `${sessionRecord.repoOwner}/${sessionRecord.repoName}`
      : null;

  if (!sessionRecord.cloneUrl || !repoIdentifier || !sessionRecord.repoOwner) {
    return Response.json(
      buildUnavailableResponse(
        "Session is not linked to a GitHub repository",
        sessionRecord.prNumber,
        repoIdentifier,
      ) satisfies MergeReadinessResponse,
    );
  }

  const repoOwner = sessionRecord.repoOwner;
  const cloneUrl = sessionRecord.cloneUrl;

  if (!sessionRecord.prNumber) {
    return Response.json(
      buildUnavailableResponse(
        "No pull request found for this session",
        null,
        repoIdentifier,
      ) satisfies MergeReadinessResponse,
    );
  }

  if (sessionRecord.prStatus === "merged") {
    return Response.json(
      buildUnavailableResponse(
        "Pull request is already merged",
        sessionRecord.prNumber,
        repoIdentifier,
      ) satisfies MergeReadinessResponse,
    );
  }

  if (sessionRecord.prStatus === "closed") {
    return Response.json(
      buildUnavailableResponse(
        "Pull request is closed",
        sessionRecord.prNumber,
        repoIdentifier,
      ) satisfies MergeReadinessResponse,
    );
  }

  let token: string;
  try {
    const tokenResult = await getRepoToken(authResult.userId, repoOwner);
    token = tokenResult.token;
  } catch {
    return Response.json(
      buildUnavailableResponse(
        "No GitHub token available for this repository",
        sessionRecord.prNumber,
        repoIdentifier,
      ) satisfies MergeReadinessResponse,
    );
  }

  const readiness = await getPullRequestMergeReadiness({
    repoUrl: cloneUrl,
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

  return Response.json({
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
      baseBranch: readiness.pr?.baseBranch ?? null,
      headBranch: readiness.pr?.headBranch ?? null,
      headSha: readiness.pr?.headSha ?? null,
    },
    allowedMethods,
    defaultMethod,
    checks: readiness.checks,
    checkRuns: readiness.checkRuns ?? [],
  } satisfies MergeReadinessResponse);
}
