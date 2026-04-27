const GITHUB_REPO_PATH_SEGMENT_PATTERN = /^[.\w-]+$/;

export function isValidGitHubRepoOwner(owner: string): boolean {
  return GITHUB_REPO_PATH_SEGMENT_PATTERN.test(owner);
}

export function isValidGitHubRepoName(repoName: string): boolean {
  return GITHUB_REPO_PATH_SEGMENT_PATTERN.test(repoName);
}

export function buildGitHubAuthRemoteUrl(params: {
  token: string;
  owner: string;
  repo: string;
}): string | null {
  const { token, owner, repo } = params;

  if (!isValidGitHubRepoOwner(owner) || !isValidGitHubRepoName(repo)) {
    return null;
  }

  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

export function createAuthenticatedRepoUrl(
  repoUrl: string,
  githubToken?: string | null,
): string {
  if (!githubToken) {
    return repoUrl;
  }

  try {
    const url = new URL(repoUrl);
    if (url.hostname === "github.com") {
      url.username = githubToken;
      url.password = "x-oauth-basic";
    }
    return url.toString();
  } catch {
    return repoUrl;
  }
}

export function getInstallationManageUrl(
  installationId: number,
  fallbackUrl?: string | null,
): string | null {
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

  if (appSlug) {
    return `https://github.com/apps/${appSlug}/installations/${installationId}`;
  }

  return fallbackUrl ?? null;
}

export function buildGitHubReconnectUrl(next: string): string {
  const params = new URLSearchParams({ step: "github", next });
  return `/get-started?${params.toString()}`;
}
