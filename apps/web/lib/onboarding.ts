import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { vercelConnections } from "@/lib/db/schema";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getInstallationsByUserId } from "@/lib/db/installations";

/**
 * Check whether a user needs to go through onboarding.
 *
 * Onboarding is required when:
 * - No Vercel team is selected (no gateway API key)
 * - No GitHub account is connected
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const [connection, ghAccount, installations] = await Promise.all([
    db
      .select({ gatewayApiKey: vercelConnections.gatewayApiKey })
      .from(vercelConnections)
      .where(eq(vercelConnections.userId, userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getGitHubAccount(userId),
    getInstallationsByUserId(userId),
  ]);

  const hasTeam = !!connection?.gatewayApiKey;
  const hasGitHub = ghAccount !== null && installations.length > 0;

  return !hasTeam || !hasGitHub;
}
