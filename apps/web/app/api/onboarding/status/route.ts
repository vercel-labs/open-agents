import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vercelConnections } from "@/lib/db/schema";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [connectionRow, ghAccount, installations] = await Promise.all([
    db
      .select({
        teamId: vercelConnections.teamId,
        teamSlug: vercelConnections.teamSlug,
        gatewayApiKey: vercelConnections.gatewayApiKey,
      })
      .from(vercelConnections)
      .where(eq(vercelConnections.userId, session.user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getGitHubAccount(session.user.id),
    getInstallationsByUserId(session.user.id),
  ]);

  const hasTeam = !!connectionRow?.gatewayApiKey;
  const hasGitHub = ghAccount !== null && installations.length > 0;

  return Response.json({
    completed: hasTeam && hasGitHub,
    hasTeamSelected: !!connectionRow?.teamId,
    hasGatewayKey: !!connectionRow?.gatewayApiKey,
    hasGitHub,
    teamId: connectionRow?.teamId ?? null,
    teamSlug: connectionRow?.teamSlug ?? null,
  });
}
