const GITHUB_REPO_PATH_SEGMENT_PATTERN = /^[.\w-]+$/;

export function isValidGitHubRepoOwner(owner: string): boolean {
  return GITHUB_REPO_PATH_SEGMENT_PATTERN.test(owner);
}

export function isValidGitHubRepoName(repoName: string): boolean {
  return GITHUB_REPO_PATH_SEGMENT_PATTERN.test(repoName);
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
