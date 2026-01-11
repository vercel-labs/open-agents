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
