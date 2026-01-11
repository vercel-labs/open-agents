import { NextRequest, NextResponse } from "next/server";
import { getUserGitHubToken } from "@/lib/github/user-token";

interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  updated_at: string;
  language: string | null;
}

interface GitHubUser {
  login: string;
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

  if (!owner) {
    return NextResponse.json(
      { error: "Owner parameter is required" },
      { status: 400 },
    );
  }

  try {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    let isAuthenticatedUser = false;
    if (userResponse.ok) {
      const user = (await userResponse.json()) as GitHubUser;
      isAuthenticatedUser = user.login === owner;
    }

    // Determine the API endpoint type once, outside the pagination loop
    let apiEndpointType: "user" | "org" | "other" = "other";
    if (isAuthenticatedUser) {
      apiEndpointType = "user";
    } else {
      const orgResponse = await fetch(`https://api.github.com/orgs/${owner}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (orgResponse.ok) {
        apiEndpointType = "org";
      }
    }

    const allRepos: GitHubRepo[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 50;

    while (page <= maxPages) {
      let apiUrl: string;

      if (apiEndpointType === "user") {
        apiUrl = `https://api.github.com/user/repos?sort=name&direction=asc&per_page=${perPage}&page=${page}&visibility=all&affiliation=owner`;
      } else if (apiEndpointType === "org") {
        apiUrl = `https://api.github.com/orgs/${owner}/repos?sort=name&direction=asc&per_page=${perPage}&page=${page}`;
      } else {
        apiUrl = `https://api.github.com/users/${owner}/repos?sort=name&direction=asc&per_page=${perPage}&page=${page}`;
      }

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const repos = (await response.json()) as GitHubRepo[];

      if (repos.length === 0) break;
      allRepos.push(...repos);
      if (repos.length < perPage) break;
      page++;
    }

    const uniqueRepos = allRepos.filter(
      (repo, index, self) =>
        index === self.findIndex((r) => r.full_name === repo.full_name),
    );
    uniqueRepos.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );

    return NextResponse.json(
      uniqueRepos.map((repo) => ({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        private: repo.private,
        clone_url: repo.clone_url,
        updated_at: repo.updated_at,
        language: repo.language,
      })),
    );
  } catch (error) {
    console.error("Error fetching repositories:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 },
    );
  }
}
