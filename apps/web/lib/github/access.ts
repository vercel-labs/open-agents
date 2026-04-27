import { getInstallationByAccountLogin } from "@/lib/db/installations";
import { getInstallationOctokit } from "./app";
import { getUserOctokit } from "./client";

export type RepoAccessDeniedReason =
  | "no_user_token"
  | "user_no_access"
  | "no_installation"
  | "app_no_access";

export type RepoAccessResult =
  | { ok: true; installationId: number }
  | { ok: false; reason: RepoAccessDeniedReason };

/**
 * Verify that the user can access a repo AND the GitHub App installation
 * covers it. Returns the installationId on success.
 *
 * This enforces the intersection: user permissions ∩ installation scope.
 */
export async function verifyRepoAccess(params: {
  userId: string;
  owner: string;
  repo: string;
}): Promise<RepoAccessResult> {
  const { userId, owner, repo } = params;

  // 1. check user can see the repo
  const userOctokit = await getUserOctokit(userId);
  if (!userOctokit) {
    return { ok: false, reason: "no_user_token" };
  }

  try {
    await userOctokit.rest.repos.get({ owner, repo });
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 403) {
      return { ok: false, reason: "user_no_access" };
    }
    throw error;
  }

  // 2. check installation exists for this owner
  const installation = await getInstallationByAccountLogin(userId, owner);
  if (!installation) {
    return { ok: false, reason: "no_installation" };
  }

  // 3. check installation covers this specific repo
  const installationOctokit = getInstallationOctokit(
    installation.installationId,
  );
  try {
    await installationOctokit.rest.repos.get({ owner, repo });
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 403) {
      return { ok: false, reason: "app_no_access" };
    }
    throw error;
  }

  return { ok: true, installationId: installation.installationId };
}

/**
 * Map access denial reasons to user-facing error messages.
 */
export function getRepoAccessErrorMessage(
  reason: RepoAccessDeniedReason,
): string {
  switch (reason) {
    case "no_user_token":
      return "Connect GitHub to access repositories";
    case "user_no_access":
      return "You don't have access to this repository";
    case "no_installation":
      return "GitHub App not installed for this organization. Install it from Settings > Connections.";
    case "app_no_access":
      return "GitHub App doesn't have access to this repository. Ask an org admin to update the app's repository permissions.";
  }
}
