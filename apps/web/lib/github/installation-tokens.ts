import { Octokit } from "@octokit/rest";
import {
  ConnectorInstallationRequiredError,
  getTokenResponse,
} from "@vercel/connect";
import {
  getGitHubConnector,
  GitHubInstallationMissingError,
} from "@/lib/github/connector";

export type GitHubInstallationPermissionValue = "read" | "write";

export type GitHubInstallationTokenPermissions = Partial<
  Record<
    | "actions"
    | "administration"
    | "checks"
    | "contents"
    | "deployments"
    | "issues"
    | "metadata"
    | "pull_requests"
    | "statuses"
    | "workflows",
    GitHubInstallationPermissionValue
  >
>;

export interface ScopedInstallationToken {
  token: string;
  expiresAt: string | null;
  installationId: number;
  repositoryIds: number[];
  permissions: GitHubInstallationTokenPermissions;
}

/**
 * Tokens come from the Vercel Connect SDK's shared in-process cache, so a
 * near-expiry cached token could otherwise be handed to a long git operation
 * (clone/fetch/push) and die mid-flight. Connect GitHub installation tokens
 * live ~15 minutes (verified against a live connector), so guarantee at
 * least this much remaining lifetime on every mint.
 */
const DEFAULT_VALIDITY_BUFFER_MS = 5 * 60_000;

/**
 * Vercel Connect GitHub app-subject tokens act as the whole installation.
 * Verified against a live connector (SDK 0.3.3 beta): `scopes` and
 * `resources` are accepted but do NOT narrow GitHub app tokens — the token
 * always carries the connector's full granted permissions. These mapping
 * seams stay so narrowing can be turned on here if Connect adds support;
 * the trust boundary is enforced by `verifyRepoAccess` (user permissions
 * intersected with installation coverage) either way.
 */
function mapPermissionsToScopes(
  _permissions: GitHubInstallationTokenPermissions,
): string[] {
  return ["*"];
}

function mapRepoToResources(_repoFullName?: string): string[] | undefined {
  return undefined;
}

/**
 * Mint a short-lived GitHub installation token via Vercel Connect. Keeps the
 * shape of the old GitHub App mint (installation + single repo + requested
 * permissions) so call sites are unchanged. Tokens are cached and shared by
 * the SDK — never revoke them after use.
 */
export async function mintInstallationToken(params: {
  installationId: number;
  repositoryIds: number[];
  permissions: GitHubInstallationTokenPermissions;
  repoFullName?: string;
  validityBufferMs?: number;
}): Promise<ScopedInstallationToken> {
  const { installationId, repositoryIds, permissions } = params;

  if (repositoryIds.length !== 1) {
    throw new Error("Installation tokens must be scoped to exactly one repo");
  }

  try {
    const response = await getTokenResponse(getGitHubConnector(), {
      subject: { type: "app" },
      installationId: String(installationId),
      scopes: mapPermissionsToScopes(permissions),
      resources: mapRepoToResources(params.repoFullName),
      validityBufferMs: params.validityBufferMs ?? DEFAULT_VALIDITY_BUFFER_MS,
    });

    return {
      token: response.token,
      expiresAt: new Date(response.expiresAt).toISOString(),
      installationId,
      repositoryIds,
      permissions,
    };
  } catch (error) {
    if (error instanceof ConnectorInstallationRequiredError) {
      throw new GitHubInstallationMissingError(
        `GitHub App installation ${installationId} not found in Vercel Connect`,
      );
    }
    throw error;
  }
}

/**
 * Run an operation with an Octokit authenticated by a scoped installation
 * token. The token is managed (cached, refreshed) by Vercel Connect and
 * shared with concurrent callers, so it is intentionally not revoked here.
 */
export async function withScopedInstallationOctokit<T>(params: {
  installationId: number;
  repositoryId: number;
  permissions: GitHubInstallationTokenPermissions;
  repoFullName?: string;
  operation: (octokit: Octokit) => Promise<T>;
}): Promise<T> {
  const scopedToken = await mintInstallationToken({
    installationId: params.installationId,
    repositoryIds: [params.repositoryId],
    permissions: params.permissions,
    repoFullName: params.repoFullName,
  });

  const octokit = new Octokit({ auth: scopedToken.token });
  return await params.operation(octokit);
}
