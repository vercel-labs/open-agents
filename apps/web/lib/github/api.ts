import "server-only";

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

interface GitHubOrg {
  login: string;
  avatar_url: string;
}

interface GitHubBranch {
  name: string;
}

interface GitHubRepoInfo {
  default_branch: string;
}

function normalizeGitHubLimit(limit: number | undefined): number | undefined {
  return typeof limit === "number" && Number.isFinite(limit)
    ? Math.max(1, Math.min(limit, 100))
    : undefined;
}

async function fetchGitHubAPI<T>(
  endpoint: string,
  token: string,
): Promise<T | null> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<T>;
}

export async function fetchGitHubUser(token: string) {
  const user = await fetchGitHubAPI<GitHubUser>("/user", token);
  if (!user) return null;

  return {
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
  };
}

export async function fetchGitHubOrgs(token: string) {
  const orgs = await fetchGitHubAPI<GitHubOrg[]>("/user/orgs", token);
  if (!orgs) return null;

  return orgs.map((org) => ({
    login: org.login,
    name: org.login,
    avatar_url: org.avatar_url,
  }));
}

export async function fetchGitHubBranches(
  token: string,
  owner: string,
  repo: string,
  limit?: number,
) {
  // Fetch repo info for default branch
  const repoInfo = await fetchGitHubAPI<GitHubRepoInfo>(
    `/repos/${owner}/${repo}`,
    token,
  );
  if (!repoInfo) return null;

  const defaultBranch = repoInfo.default_branch;
  const normalizedLimit = normalizeGitHubLimit(limit);

  // Fetch branches with pagination only when needed
  const allBranches: string[] = [];
  let page = 1;
  const perPage = normalizedLimit ?? 100;
  const maxPages = normalizedLimit ? 1 : 50;

  while (page <= maxPages) {
    const branches = await fetchGitHubAPI<GitHubBranch[]>(
      `/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
      token,
    );

    if (!branches) {
      // API error on first page means failure; on subsequent pages, return what we have
      if (page === 1) return null;
      break;
    }
    if (branches.length === 0) break;

    allBranches.push(...branches.map((b) => b.name));
    if (normalizedLimit && allBranches.length >= normalizedLimit) {
      break;
    }
    if (branches.length < perPage) break;
    page++;
  }

  if (normalizedLimit && !allBranches.includes(defaultBranch)) {
    allBranches.push(defaultBranch);
  }

  // Sort with default branch first
  allBranches.sort((a, b) => {
    if (a === defaultBranch) return -1;
    if (b === defaultBranch) return 1;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  return {
    branches: normalizedLimit
      ? allBranches.slice(0, normalizedLimit)
      : allBranches,
    defaultBranch,
  };
}
