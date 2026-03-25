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
