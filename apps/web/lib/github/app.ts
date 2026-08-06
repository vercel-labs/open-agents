import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

interface GitHubAppConfig {
  appId: number;
  privateKey: string;
}

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

const installationTokenResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string().nullable().optional(),
});

function parsePrivateKey(value: string): string {
  const unescaped = value.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("BEGIN") && unescaped.includes("PRIVATE KEY")) {
    return unescaped;
  }

  const decoded = Buffer.from(value, "base64").toString("utf-8").trim();
  if (decoded.includes("BEGIN") && decoded.includes("PRIVATE KEY")) {
    return decoded;
  }

  throw new Error("Invalid GITHUB_APP_PRIVATE_KEY format");
}

function getGitHubAppConfig(): GitHubAppConfig {
  const appIdRaw = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appIdRaw || !privateKeyRaw) {
    throw new Error("GitHub App is not configured");
  }

  const appId = Number.parseInt(appIdRaw, 10);
  if (!Number.isFinite(appId)) {
    throw new Error("Invalid GITHUB_APP_ID");
  }

  const privateKey = parsePrivateKey(privateKeyRaw);

  return { appId, privateKey };
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY,
  );
}

async function getAppJwt(): Promise<string> {
  const { appId, privateKey } = getGitHubAppConfig();

  const auth = createAppAuth({
    appId,
    privateKey,
  });

  const authResult = await auth({ type: "app" });
  return authResult.token;
}

export async function mintInstallationToken(params: {
  installationId: number;
  repositoryIds: number[];
  permissions: GitHubInstallationTokenPermissions;
}): Promise<ScopedInstallationToken> {
  const { installationId, repositoryIds, permissions } = params;

  if (repositoryIds.length !== 1) {
    throw new Error("Installation tokens must be scoped to exactly one repo");
  }

  const appJwt = await getAppJwt();
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        repository_ids: repositoryIds,
        permissions,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to mint GitHub installation token: ${response.status} ${body}`,
    );
  }

  const payload: unknown = await response.json();
  const parsed = installationTokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Invalid GitHub installation token response");
  }

  return {
    token: parsed.data.token,
    expiresAt: parsed.data.expires_at ?? null,
    installationId,
    repositoryIds,
    permissions,
  };
}

export async function revokeInstallationToken(token: string): Promise<void> {
  const response = await fetch("https://api.github.com/installation/token", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    console.warn(
      `Failed to revoke GitHub installation token: ${response.status} ${body}`,
    );
  }
}

export async function withScopedInstallationOctokit<T>(params: {
  installationId: number;
  repositoryId: number;
  permissions: GitHubInstallationTokenPermissions;
  operation: (octokit: Octokit) => Promise<T>;
}): Promise<T> {
  const scopedToken = await mintInstallationToken({
    installationId: params.installationId,
    repositoryIds: [params.repositoryId],
    permissions: params.permissions,
  });

  const octokit = new Octokit({ auth: scopedToken.token });

  try {
    return await params.operation(octokit);
  } finally {
    await revokeInstallationToken(scopedToken.token);
  }
}

export function getAppOctokit(): Octokit {
  const { appId, privateKey } = getGitHubAppConfig();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });
}
