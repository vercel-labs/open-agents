import "server-only";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { hasGitHubAccount } from "@/lib/github/token";

/**
 * Check whether a user needs to go through onboarding.
 * Returns true when GitHub account is not linked or no installations exist.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const [linked, installations] = await Promise.all([
    hasGitHubAccount(userId),
    getInstallationsByUserId(userId),
  ]);

  return !linked || installations.length === 0;
}
