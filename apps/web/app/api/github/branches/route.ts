import { NextRequest, NextResponse } from "next/server";
import { getCachedGitHubBranches } from "@/lib/github/cached-api";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getServerSession } from "@/lib/session/get-server-session";

interface PublicRepoInfo {
  default_branch: string;
}

interface PublicBranch {
  name: string;
}

function parsePublicRepoInfo(value: unknown): PublicRepoInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const defaultBranch = Reflect.get(value, "default_branch");
  if (typeof defaultBranch !== "string") {
    return null;
  }

  return { default_branch: defaultBranch };
}

function parsePublicBranches(value: unknown): PublicBranch[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const branches: PublicBranch[] = [];
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

async function fetchPublicGitHubBranches(
  owner: string,
  repo: string,
): Promise<{
  branches: string[];
  defaultBranch: string;
} | null> {
  const repoInfoResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );

  if (!repoInfoResponse.ok) {
    return null;
  }

  const repoInfoJson: unknown = await repoInfoResponse.json();
  const repoInfo = parsePublicRepoInfo(repoInfoJson);
  if (!repoInfo) {
    return null;
  }
  const defaultBranch = repoInfo.default_branch;
  const branches: string[] = [];

  const perPage = 100;
  const maxPages = 10;
  for (let page = 1; page <= maxPages; page += 1) {
    const branchesResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
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
    const pageBranches = parsePublicBranches(pageBranchesJson);
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

    if (pageBranches.length < perPage) {
      break;
    }
  }

  branches.sort((a, b) => {
    if (a === defaultBranch) {
      return -1;
    }
    if (b === defaultBranch) {
      return 1;
    }
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  return {
    branches,
    defaultBranch,
  };
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

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Owner and repo parameters are required" },
      { status: 400 },
    );
  }

  let token: string | null = null;
  try {
    const tokenResult = await getRepoToken(session.user.id, owner);
    token = tokenResult.token;
  } catch {
    token = null;
  }

  try {
    if (token) {
      const result = await getCachedGitHubBranches(
        session.user.id,
        token,
        owner,
        repo,
      );

      if (result) {
        return NextResponse.json(result);
      }
    }

    const publicResult = await fetchPublicGitHubBranches(owner, repo);
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
