import { NextResponse } from "next/server";
import { getUserGitHubToken } from "@/lib/github/user-token";

interface GitHubUser {
  login: string;
  name: string | null;
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
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const user = (await response.json()) as GitHubUser;

    return NextResponse.json({
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    });
  } catch (error) {
    console.error("Error fetching GitHub user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 },
    );
  }
}
