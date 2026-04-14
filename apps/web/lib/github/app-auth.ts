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
 * Cached co-author trailer so we only hit the GitHub API once per process.
 * `undefined` = not yet fetched.
 */
let cachedTrailer: string | null | undefined;

/**
 * Returns a git commit trailer for co-authoring with the GitHub App bot, e.g.:
 *   Co-Authored-By: open-agents[bot] <260704009+open-agents[bot]@users.noreply.github.com>
 *
 * The numeric prefix is the bot's **user** ID (not the app ID) so that GitHub
 * can resolve the account and display the bot avatar inline on PR commits.
 *
 * The result is cached for the lifetime of the process.
 * Returns null if the app is not configured.
 */
export async function getAppCoAuthorTrailer(): Promise<string | null> {
  if (cachedTrailer !== undefined) return cachedTrailer;

  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!slug) {
    cachedTrailer = null;
    return null;
  }

  const botName = `${slug}[bot]`;
  let botUserId: number | null = null;

  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(botName)}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (res.ok) {
      const data = (await res.json()) as { id?: number };
      botUserId = data.id ?? null;
    }
  } catch {
    // Fall back to email without numeric prefix
  }

  const botEmail = botUserId
    ? `${botUserId}+${botName}@users.noreply.github.com`
    : `${botName}@users.noreply.github.com`;
  cachedTrailer = `Co-Authored-By: ${botName} <${botEmail}>`;
  return cachedTrailer;
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
