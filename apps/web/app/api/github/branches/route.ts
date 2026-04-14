import { NextRequest, NextResponse } from "next/server";
import { fetchGitHubBranches } from "@/lib/github/api";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

interface RepoInfo {
  default_branch: string;
}

interface Branch {
  name: string;
}

function normalizeGitHubLimit(limit: number | undefined): number | undefined {
  return typeof limit === "number" && Number.isFinite(limit)
    ? Math.max(1, Math.min(limit, 100))
    : undefined;
}

function parseRepoInfo(value: unknown): RepoInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const defaultBranch = Reflect.get(value, "default_branch");
  if (typeof defaultBranch !== "string") {
    return null;
  }

  return { default_branch: defaultBranch };
}

function parseBranches(value: unknown): Branch[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const branches: Branch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const name = Reflect.get(item, "name");
    if (typeof name !== "string") {
      return null;
    }

    branches.push({ name });
  }

  return branches;
}

function parseMatchingRefs(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const branches: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const ref = Reflect.get(item, "ref");
    if (typeof ref !== "string") {
      return null;
    }

    if (ref.startsWith("refs/heads/")) {
      branches.push(ref.slice("refs/heads/".length));
    }
  }

  return branches;
}

function sortBranches(branches: string[], defaultBranch: string) {
  branches.sort((a, b) => {
    if (a === defaultBranch) {
      return -1;
    }
    if (b === defaultBranch) {
      return 1;
    }
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
}

function getGitHubHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchGitHubRepoInfo(
  owner: string,
  repo: string,
  token?: string,
): Promise<RepoInfo | null> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: getGitHubHeaders(token),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return null;
  }

  const repoInfoJson: unknown = await response.json();
  return parseRepoInfo(repoInfoJson);
}

async function fetchMatchingBranches(
  owner: string,
  repo: string,
  defaultBranch: string,
  query: string,
  limit?: number,
  token?: string,
): Promise<{
  branches: string[];
  defaultBranch: string;
} | null> {
  const normalizedLimit = normalizeGitHubLimit(limit);
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/matching-refs/heads/${encodeURIComponent(query)}`,
    {
      headers: getGitHubHeaders(token),
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return { branches: [], defaultBranch };
  }

  if (!response.ok) {
    return null;
  }

  const refsJson: unknown = await response.json();
  const branches = parseMatchingRefs(refsJson);
  if (!branches) {
    return null;
  }

  sortBranches(branches, defaultBranch);

  return {
    branches: normalizedLimit ? branches.slice(0, normalizedLimit) : branches,
    defaultBranch,
  };
}

async function fetchPublicGitHubBranches(
  owner: string,
  repo: string,
  limit?: number,
  query?: string,
): Promise<{
  branches: string[];
  defaultBranch: string;
} | null> {
  const repoInfo = await fetchGitHubRepoInfo(owner, repo);
  if (!repoInfo) {
    return null;
  }

  const defaultBranch = repoInfo.default_branch;
  if (query) {
    return fetchMatchingBranches(owner, repo, defaultBranch, query, limit);
  }

  const normalizedLimit = normalizeGitHubLimit(limit);
  const branches: string[] = [];

  const perPage = normalizedLimit ?? 100;
  const maxPages = normalizedLimit ? 1 : 10;
  for (let page = 1; page <= maxPages; page += 1) {
    const branchesResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
      {
        headers: getGitHubHeaders(),
        cache: "no-store",
      },
    );

    if (!branchesResponse.ok) {
      if (page === 1) {
        return null;
      }
      break;
    }

    const pageBranchesJson: unknown = await branchesResponse.json();
    const pageBranches = parseBranches(pageBranchesJson);
    if (!pageBranches) {
      if (page === 1) {
        return null;
      }
      break;
    }
    if (pageBranches.length === 0) {
      break;
    }

    for (const branch of pageBranches) {
      branches.push(branch.name);
    }

    if (normalizedLimit && branches.length >= normalizedLimit) {
      break;
    }

    if (pageBranches.length < perPage) {
      break;
    }
  }

  if (normalizedLimit && !branches.includes(defaultBranch)) {
    branches.push(defaultBranch);
  }

  sortBranches(branches, defaultBranch);

  return {
    branches: normalizedLimit ? branches.slice(0, normalizedLimit) : branches,
    defaultBranch,
  };
}

async function fetchAuthenticatedGitHubBranchMatches(
  owner: string,
  repo: string,
  token: string,
  query: string,
  limit?: number,
): Promise<{
  branches: string[];
  defaultBranch: string;
} | null> {
  const repoInfo = await fetchGitHubRepoInfo(owner, repo, token);
  if (!repoInfo) {
    return null;
  }

  return fetchMatchingBranches(
    owner,
    repo,
    repoInfo.default_branch,
    query,
    limit,
    token,
  );
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const rawLimit = searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const limit = normalizeGitHubLimit(parsedLimit);
  const query = searchParams.get("query")?.trim() || undefined;

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Owner and repo parameters are required" },
      { status: 400 },
    );
  }

  const token = await getUserGitHubToken(session.user.id);

  try {
    if (token) {
      const result = query
        ? await fetchAuthenticatedGitHubBranchMatches(
            owner,
            repo,
            token,
            query,
            limit,
          )
        : await fetchGitHubBranches(token, owner, repo, limit);

      if (result) {
        return NextResponse.json(result);
      }
    }

    const publicResult = await fetchPublicGitHubBranches(
      owner,
      repo,
      limit,
      query,
    );
    if (publicResult) {
      return NextResponse.json(publicResult);
    }

    return NextResponse.json(
      { error: "Failed to fetch branches" },
      { status: 500 },
    );
  } catch (error) {
    console.error("Error fetching branches:", error);
    return NextResponse.json(
      { error: "Failed to fetch branches" },
      { status: 500 },
    );
  }
}
