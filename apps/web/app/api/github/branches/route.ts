import { NextRequest, NextResponse } from "next/server";
import { getUserGitHubToken } from "@/lib/github/user-token";

interface GitHubBranch {
  name: string;
}

interface GitHubRepo {
  default_branch: string;
}

export async function GET(request: NextRequest) {
  const token = await getUserGitHubToken();

  if (!token) {
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

  try {
    // Fetch repo info to get default branch
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    let defaultBranch = "main";
    if (repoResponse.ok) {
      const repoData = (await repoResponse.json()) as GitHubRepo;
      defaultBranch = repoData.default_branch;
    }

    // Fetch branches with pagination
    const allBranches: string[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const branches = (await response.json()) as GitHubBranch[];

      if (branches.length === 0) break;
      allBranches.push(...branches.map((b) => b.name));
      if (branches.length < perPage) break;
      page++;
    }

    // Sort branches alphabetically, but put default branch first
    allBranches.sort((a, b) => {
      if (a === defaultBranch) return -1;
      if (b === defaultBranch) return 1;
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    return NextResponse.json({
      branches: allBranches,
      defaultBranch,
    });
  } catch (error) {
    console.error("Error fetching branches:", error);
    return NextResponse.json(
      { error: "Failed to fetch branches" },
      { status: 500 },
    );
  }
}
