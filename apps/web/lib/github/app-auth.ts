import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

interface GitHubAppConfig {
  appId: number;
  privateKey: string;
}

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

/**
 * Returns a git commit trailer for co-authoring with the GitHub App bot, e.g.:
 *   Co-Authored-By: open-agents[bot] <12345+open-agents[bot]@users.noreply.github.com>
 *
 * GitHub uses this to display "user and bot committed" on commits.
 * Returns null if the app is not configured.
 */
export function getAppCoAuthorTrailer(): string | null {
  const appId = process.env.GITHUB_APP_ID;
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!appId || !slug) return null;
  const botName = `${slug}[bot]`;
  const botEmail = `${appId}+${botName}@users.noreply.github.com`;
  return `Co-Authored-By: ${botName} <${botEmail}>`;
}

export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const { appId, privateKey } = getGitHubAppConfig();

  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const authResult = await auth({ type: "installation", installationId });
  return authResult.token;
}

export function getInstallationOctokit(installationId: number): Octokit {
  const { appId, privateKey } = getGitHubAppConfig();

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });
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
