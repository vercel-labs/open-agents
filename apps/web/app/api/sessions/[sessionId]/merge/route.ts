import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import {
  deleteBranchRef,
  getPullRequestMergeReadiness,
  mergePullRequest,
  type PullRequestMergeMethod,
} from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/token";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

interface MergePullRequestRequest {
  mergeMethod?: PullRequestMergeMethod;
  commitTitle?: string;
  commitMessage?: string;
  deleteBranch?: boolean;
  expectedHeadSha?: string;
  force?: boolean;
}

export type MergePullRequestResponse = {
  merged: boolean;
  prNumber: number;
  mergeCommitSha: string | null;
  branchDeleted: boolean;
  branchDeleteError: string | null;
};

function isMergeMethod(value: unknown): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

function parseRequestBody(value: unknown): MergePullRequestRequest {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;

  const mergeMethod = isMergeMethod(record.mergeMethod)
    ? record.mergeMethod
    : undefined;

  const commitTitle =
    typeof record.commitTitle === "string" ? record.commitTitle : undefined;
  const commitMessage =
    typeof record.commitMessage === "string" ? record.commitMessage : undefined;
  const deleteBranch =
    typeof record.deleteBranch === "boolean" ? record.deleteBranch : undefined;
  const expectedHeadSha =
    typeof record.expectedHeadSha === "string"
      ? record.expectedHeadSha
      : undefined;
  const force = typeof record.force === "boolean" ? record.force : undefined;

  return {
    mergeMethod,
    commitTitle,
    commitMessage,
    deleteBranch,
    expectedHeadSha,
    force,
  };
}

export async function POST(req: Request, context: RouteContext) {
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

  if (
    !sessionRecord.cloneUrl ||
    !sessionRecord.repoOwner ||
    !sessionRecord.repoName
  ) {
    return Response.json(
      { error: "Session is not linked to a GitHub repository" },
      { status: 400 },
    );
  }

  if (!sessionRecord.prNumber) {
    return Response.json(
      { error: "No pull request found for this session" },
      { status: 400 },
    );
  }

  if (sessionRecord.prStatus === "merged") {
    return Response.json({
      merged: true,
      prNumber: sessionRecord.prNumber,
      mergeCommitSha: null,
      branchDeleted: false,
      branchDeleteError: null,
    } satisfies MergePullRequestResponse);
  }

  if (sessionRecord.prStatus === "closed") {
    return Response.json({ error: "Pull request is closed" }, { status: 409 });
  }

  let parsedBody: MergePullRequestRequest = {};
  const rawBody = await req.text();

  if (rawBody.trim().length > 0) {
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    parsedBody = parseRequestBody(jsonBody);
  }

  if (
    parsedBody.expectedHeadSha &&
    !/^[a-f0-9]{7,40}$/i.test(parsedBody.expectedHeadSha)
  ) {
    return Response.json(
      { error: "Invalid expected head SHA" },
      { status: 400 },
    );
  }

  const token = await getUserGitHubToken(authResult.userId);
  if (!token) {
    return Response.json(
      { error: "No GitHub token available for this repository" },
      { status: 403 },
    );
  }

  const readiness = await getPullRequestMergeReadiness({
    repoUrl: sessionRecord.cloneUrl,
    prNumber: sessionRecord.prNumber,
    token,
  });

  if (!readiness.success || !readiness.pr) {
    return Response.json(
      {
        error: readiness.error ?? "Failed to check pull request readiness",
      },
      { status: 502 },
    );
  }

  const expectedHeadSha = parsedBody.expectedHeadSha ?? readiness.pr.headSha;

  if (expectedHeadSha !== readiness.pr.headSha) {
    return Response.json(
      {
        error:
          "Pull request has new commits. Refresh and review before merging.",
      },
      { status: 409 },
    );
  }

  // Reasons that can be bypassed with force (CI / check failures only)
  const forceBypassableReasons = new Set([
    "Required checks are failing",
    "Required checks are still pending",
    "Required checks are still in progress",
    "Branch protection requirements are not yet satisfied",
  ]);

  if (!readiness.canMerge) {
    const nonBypassableReasons = readiness.reasons.filter(
      (r) => !forceBypassableReasons.has(r),
    );

    if (!parsedBody.force || nonBypassableReasons.length > 0) {
      const reasons = parsedBody.force
        ? nonBypassableReasons
        : readiness.reasons;
      return Response.json(
        {
          error: reasons.join(". "),
          reasons,
        },
        { status: 409 },
      );
    }
  }

  const requestedMethod = parsedBody.mergeMethod ?? readiness.defaultMethod;
  if (!readiness.allowedMethods.includes(requestedMethod)) {
    return Response.json(
      { error: "Selected merge method is not allowed for this repository" },
      { status: 400 },
    );
  }

  const mergeResult = await mergePullRequest({
    repoUrl: sessionRecord.cloneUrl,
    prNumber: sessionRecord.prNumber,
    mergeMethod: requestedMethod,
    expectedHeadSha,
    commitTitle: parsedBody.commitTitle,
    commitMessage: parsedBody.commitMessage,
    token,
  });

  if (!mergeResult.success) {
    return Response.json(
      { error: mergeResult.error ?? "Failed to merge pull request" },
      { status: mergeResult.statusCode ?? 502 },
    );
  }

  let branchDeleted = false;
  let branchDeleteError: string | null = null;
  const shouldDeleteBranch = parsedBody.deleteBranch ?? true;

  if (shouldDeleteBranch && readiness.pr.headBranch) {
    const normalizedRepoOwner = sessionRecord.repoOwner.toLowerCase();
    const normalizedHeadOwner = readiness.pr.headOwner?.toLowerCase() ?? null;

    if (!normalizedHeadOwner) {
      branchDeleteError =
        "Source branch owner could not be determined; branch was not deleted";
    } else if (normalizedHeadOwner !== normalizedRepoOwner) {
      branchDeleteError = "Source branch belongs to a fork and was not deleted";
    } else {
      const deleteResult = await deleteBranchRef({
        repoUrl: sessionRecord.cloneUrl,
        branchName: readiness.pr.headBranch,
        token,
      });

      if (deleteResult.success || deleteResult.statusCode === 404) {
        branchDeleted = true;
      } else if (deleteResult.error) {
        branchDeleteError = deleteResult.error;
      }
    }
  }

  await updateSession(sessionRecord.id, {
    prStatus: "merged",
  });

  return Response.json({
    merged: true,
    prNumber: sessionRecord.prNumber,
    mergeCommitSha: mergeResult.sha ?? null,
    branchDeleted,
    branchDeleteError,
  } satisfies MergePullRequestResponse);
}
