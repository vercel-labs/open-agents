import { getSessionById } from "@/lib/db/sessions";
import { findLatestVercelDeploymentUrlForPullRequest } from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type PrDeploymentResponse = {
  deploymentUrl: string | null;
};

export async function GET(req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const sessionRecord = await getSessionById(sessionId);

  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedPrNumber = new URL(req.url).searchParams.get("prNumber");
  const parsedPrNumber = requestedPrNumber ? Number(requestedPrNumber) : null;

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

  if (
    !sessionRecord.repoOwner ||
    !sessionRecord.repoName ||
    sessionRecord.prNumber === null
  ) {
    return Response.json({
      deploymentUrl: null,
    } satisfies PrDeploymentResponse);
  }

  let token: string;
  try {
    const tokenResult = await getRepoToken(
      session.user.id,
      sessionRecord.repoOwner,
    );
    token = tokenResult.token;
  } catch {
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
