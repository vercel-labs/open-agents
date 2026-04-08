import "server-only";
import { unstable_cache } from "next/cache";

const CACHE_REVALIDATE_SECONDS = 300; // 5 minutes

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

interface GitHubOrg {
  login: string;
  avatar_url: string;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  updated_at: string;
  language: string | null;
}

interface GitHubBranch {
  name: string;
}

interface GitHubRepoInfo {
  default_branch: string;
}

interface GitHubRepoOptions {
  limit?: number;
  query?: string;
}

function normalizeGitHubLimit(limit: number | undefined): number | undefined {
  return typeof limit === "number" && Number.isFinite(limit)
    ? Math.max(1, Math.min(limit, 100))
    : undefined;
}

function compareReposByRecentActivity(
  a: Pick<GitHubRepo, "name" | "updated_at">,
  b: Pick<GitHubRepo, "name" | "updated_at">,
): number {
  const updatedAtA = Date.parse(a.updated_at);
  const updatedAtB = Date.parse(b.updated_at);

  if (updatedAtA !== updatedAtB) {
    return updatedAtB - updatedAtA;
  }

  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

interface GitHubSearchResponse {
  items: GitHubRepo[];
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

export const getCachedGitHubUser = unstable_cache(
  async (userId: string, token: string) => {
    const user = await fetchGitHubAPI<GitHubUser>("/user", token);
    if (!user) return null;

    return {
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    };
  },
  ["github-user"],
  { revalidate: CACHE_REVALIDATE_SECONDS },
);

export const getCachedGitHubOrgs = unstable_cache(
  async (userId: string, token: string) => {
    const orgs = await fetchGitHubAPI<GitHubOrg[]>("/user/orgs", token);
    if (!orgs) return null;

    return orgs.map((org) => ({
      login: org.login,
      name: org.login,
      avatar_url: org.avatar_url,
    }));
  },
  ["github-orgs"],
  { revalidate: CACHE_REVALIDATE_SECONDS },
);

// Helper to create user-scoped cache tags
export function getGitHubReposCacheTag(userId: string): string {
  return `github-repos-${userId}`;
}

async function fetchGitHubReposInternal(
  userId: string,
  token: string,
  owner: string,
  options?: GitHubRepoOptions,
) {
  const normalizedLimit = normalizeGitHubLimit(options?.limit);
  const normalizedQuery = options?.query?.trim() || undefined;
  // Check if owner is the authenticated user
  const currentUser = await fetchGitHubAPI<{ login: string }>("/user", token);
  if (!currentUser) return null;

  const isAuthenticatedUser = currentUser.login === owner;

  // Determine endpoint type
  let apiEndpointType: "user" | "org" | "other" = "other";
  if (isAuthenticatedUser) {
    apiEndpointType = "user";
  } else {
    const orgResponse = await fetchGitHubAPI<unknown>(`/orgs/${owner}`, token);
    if (orgResponse) {
      apiEndpointType = "org";
    }
  }

  if (normalizedQuery) {
    const perPage = normalizedLimit ?? 50;
    const ownerQualifier = apiEndpointType === "org" ? "org" : "user";
    const searchQuery = `${normalizedQuery} in:name ${ownerQualifier}:${owner}`;
    const searchEndpoint = `/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=updated&order=desc&per_page=${perPage}`;
    const searchResult = await fetchGitHubAPI<GitHubSearchResponse>(
      searchEndpoint,
      token,
    );

    if (!searchResult) return null;

    return searchResult.items.map((repo) => ({
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      clone_url: repo.clone_url,
      updated_at: repo.updated_at,
      language: repo.language,
    }));
  }

  // Fetch all repos with pagination
  const allRepos: GitHubRepo[] = [];
  let page = 1;
  const perPage = normalizedLimit ?? 100;
  const maxPages = normalizedLimit ? 1 : 50;

  while (page <= maxPages) {
    let endpoint: string;

    if (apiEndpointType === "user") {
      endpoint = `/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&visibility=all&affiliation=owner`;
    } else if (apiEndpointType === "org") {
      endpoint = `/orgs/${owner}/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&type=all&visibility=all`;
    } else {
      endpoint = `/users/${owner}/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
    }

    const repos = await fetchGitHubAPI<GitHubRepo[]>(endpoint, token);
    if (!repos) {
      // API error on first page means failure; on subsequent pages, return what we have
      if (page === 1) return null;
      break;
    }
    if (repos.length === 0) break;

    allRepos.push(...repos);
    if (repos.length < perPage) break;
    page++;
  }

  // Dedupe and sort
  const uniqueRepos = allRepos.filter(
    (repo, index, self) =>
      index === self.findIndex((r) => r.full_name === repo.full_name),
  );
  uniqueRepos.sort(compareReposByRecentActivity);

  const mappedRepos = uniqueRepos.map((repo) => ({
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    clone_url: repo.clone_url,
    updated_at: repo.updated_at,
    language: repo.language,
  }));

  if (normalizedLimit) {
    return mappedRepos.slice(0, normalizedLimit);
  }

  return mappedRepos;
}

export function getCachedGitHubRepos(
  userId: string,
  token: string,
  owner: string,
  options?: GitHubRepoOptions,
) {
  // Create a cached version with user-specific tag for invalidation
  const cachedFn = unstable_cache(fetchGitHubReposInternal, ["github-repos"], {
    revalidate: CACHE_REVALIDATE_SECONDS,
    tags: [getGitHubReposCacheTag(userId)],
  });

  return cachedFn(userId, token, owner, options);
}

export const getCachedGitHubBranches = unstable_cache(
  async (
    userId: string,
    token: string,
    owner: string,
    repo: string,
    limit?: number,
  ) => {
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
  },
  ["github-branches"],
  { revalidate: CACHE_REVALIDATE_SECONDS },
);
