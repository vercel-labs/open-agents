import "server-only";
import {
  getInstallationByAccountLogin,
  getInstallationsByUserId,
} from "@/lib/db/installations";
import { getInstallationToken } from "@/lib/github/app-auth";
import { getUserGitHubToken } from "@/lib/github/user-token";

type RepoTokenResult =
  | { token: string; type: "installation"; installationId: number }
  | { token: string; type: "user" };

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export async function getRepoToken(
  userId: string,
  owner: string,
): Promise<RepoTokenResult> {
  const normalizedOwner = normalizeLogin(owner);

  const directMatch = await getInstallationByAccountLogin(userId, owner);
  if (directMatch) {
    try {
      const token = await getInstallationToken(directMatch.installationId);
      return {
        token,
        type: "installation",
        installationId: directMatch.installationId,
      };
    } catch (error) {
      console.error(
        `Failed to get installation token for ${owner}, falling back to user token:`,
        error,
      );
    }
  }

  const installations = await getInstallationsByUserId(userId);
  const fallbackMatch = installations.find(
    (installation) =>
      normalizeLogin(installation.accountLogin) === normalizedOwner,
  );

  if (fallbackMatch) {
    try {
      const token = await getInstallationToken(fallbackMatch.installationId);
      return {
        token,
        type: "installation",
        installationId: fallbackMatch.installationId,
      };
    } catch (error) {
      console.error(
        `Failed to get installation token for ${owner}, falling back to user token:`,
        error,
      );
    }
  }

  const userToken = await getUserGitHubToken(userId);
  if (userToken) {
    return { token: userToken, type: "user" };
  }

  throw new Error(`No GitHub token available for owner ${owner}`);
}
