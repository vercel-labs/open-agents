import { NextResponse } from "next/server";
import { getUserGitHubToken } from "@/lib/github/user-token";

interface GitHubOrg {
  login: string;
  avatar_url: string;
}

export async function GET() {
  const token = await getUserGitHubToken();

  if (!token) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  try {
    const response = await fetch("https://api.github.com/user/orgs", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const orgs = (await response.json()) as GitHubOrg[];

    return NextResponse.json(
      orgs.map((org) => ({
        login: org.login,
        name: org.login,
        avatar_url: org.avatar_url,
      })),
    );
  } catch (error) {
    console.error("Error fetching organizations:", error);
    return NextResponse.json(
      { error: "Failed to fetch organizations" },
      { status: 500 },
    );
  }
}
