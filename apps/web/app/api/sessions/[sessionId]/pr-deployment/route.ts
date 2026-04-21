import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { findLatestVercelDeploymentUrlForPullRequest } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/token";
import {
  findLatestBuildingDeploymentUrlForBranch,
  findLatestFailedDeploymentInspectorUrlForBranch,
  findLatestPreviewDeploymentUrlForBranch,
} from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type PrDeploymentResponse = {
  deploymentUrl: string | null;
  buildingDeploymentUrl?: string | null;
  failedDeploymentUrl?: string | null;
};

export async function GET(req: Request, context: RouteContext) {
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

  const searchParams = new URL(req.url).searchParams;
  const requestedPrNumber = searchParams.get("prNumber");
  const parsedPrNumber = requestedPrNumber ? Number(requestedPrNumber) : null;
  const requestedBranch = searchParams.get("branch")?.trim() || null;

  if (
    parsedPrNumber !== null &&
    (Number.isNaN(parsedPrNumber) || parsedPrNumber <= 0)
  ) {
    return Response.json({
      deploymentUrl: null,
    } satisfies PrDeploymentResponse);
  }

  if (
    parsedPrNumber !== null &&
    sessionRecord.prNumber !== null &&
    parsedPrNumber !== sessionRecord.prNumber
  ) {
    return Response.json({
      deploymentUrl: null,
    } satisfies PrDeploymentResponse);
  }

  const previewLookupBranch = requestedBranch ?? sessionRecord.branch;

  // Try the Vercel API first — it's the most reliable source since it queries
  // deployments by branch directly, regardless of whether a PR exists.
  if (sessionRecord.vercelProjectId && previewLookupBranch) {
    const vercelToken = await getUserVercelToken(authResult.userId);
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
        return Response.json({
          deploymentUrl,
          buildingDeploymentUrl,
          failedDeploymentUrl,
        } satisfies PrDeploymentResponse);
      }
    }
  }

  // Fall back to searching GitHub PR comments for Vercel deployment URLs.
  if (
    !sessionRecord.repoOwner ||
    !sessionRecord.repoName ||
    sessionRecord.prNumber === null
  ) {
    return Response.json({
      deploymentUrl: null,
    } satisfies PrDeploymentResponse);
  }

  const token = await getUserGitHubToken(authResult.userId);
  if (!token) {
    return Response.json({
      deploymentUrl: null,
    } satisfies PrDeploymentResponse);
  }

  const deploymentResult = await findLatestVercelDeploymentUrlForPullRequest({
    owner: sessionRecord.repoOwner,
    repo: sessionRecord.repoName,
    prNumber: sessionRecord.prNumber,
    token,
  });

  if (!deploymentResult.success) {
    return Response.json({
      deploymentUrl: null,
    } satisfies PrDeploymentResponse);
  }

  return Response.json({
    deploymentUrl: deploymentResult.deploymentUrl ?? null,
  } satisfies PrDeploymentResponse);
}
