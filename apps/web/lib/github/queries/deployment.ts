"use server";

import { getSessionById } from "@/lib/db/sessions";
import { findDeploymentUrl } from "@/lib/github/pulls";
import { getUserGitHubToken } from "@/lib/github/token";
import {
  findLatestBuildingDeploymentUrlForBranch,
  findLatestFailedDeploymentInspectorUrlForBranch,
  findLatestPreviewDeploymentUrlForBranch,
} from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";
import { getServerSession } from "@/lib/session/get-server-session";

// ---- types ----

export type PrDeploymentResponse = {
  deploymentUrl: string | null;
  buildingDeploymentUrl?: string | null;
  failedDeploymentUrl?: string | null;
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

// ---- server action ----

export async function getDeploymentUrl(params: {
  sessionId: string;
  prNumber?: number;
  branch?: string;
}): Promise<PrDeploymentResponse> {
  const { sessionId, prNumber, branch } = params;

  const session = await requireAuth();
  const sessionRecord = await requireOwnedSession(session.user.id, sessionId);

  // validate prNumber if provided
  if (prNumber !== undefined && (Number.isNaN(prNumber) || prNumber <= 0)) {
    return { deploymentUrl: null };
  }

  if (
    prNumber !== undefined &&
    sessionRecord.prNumber !== null &&
    prNumber !== sessionRecord.prNumber
  ) {
    return { deploymentUrl: null };
  }

  const previewLookupBranch = branch ?? sessionRecord.branch;

  // try the Vercel API first
  if (sessionRecord.vercelProjectId && previewLookupBranch) {
    const vercelToken = await getUserVercelToken(session.user.id);
    if (vercelToken) {
      const lookupParams = {
        token: vercelToken,
        projectIdOrName: sessionRecord.vercelProjectId,
        branch: previewLookupBranch,
        teamId: sessionRecord.vercelTeamId,
      };

      const [deploymentUrl, buildingDeploymentUrl, failedDeploymentUrl] =
        await Promise.all([
          findLatestPreviewDeploymentUrlForBranch(lookupParams).catch(
            () => null,
          ),
          findLatestBuildingDeploymentUrlForBranch(lookupParams).catch(
            () => null,
          ),
          findLatestFailedDeploymentInspectorUrlForBranch(lookupParams).catch(
            () => null,
          ),
        ]);

      if (deploymentUrl || buildingDeploymentUrl || failedDeploymentUrl) {
        return {
          deploymentUrl,
          buildingDeploymentUrl,
          failedDeploymentUrl,
        };
      }
    }
  }

  // fall back to searching GitHub PR comments for Vercel deployment URLs
  if (
    !sessionRecord.repoOwner ||
    !sessionRecord.repoName ||
    sessionRecord.prNumber === null
  ) {
    return { deploymentUrl: null };
  }

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    return { deploymentUrl: null };
  }

  const deploymentResult = await findDeploymentUrl({
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
    prNumber: sessionRecord.prNumber,
    token,
  });

  if (!deploymentResult.success) {
    return { deploymentUrl: null };
  }

  return {
    deploymentUrl: deploymentResult.deploymentUrl ?? null,
  };
}
