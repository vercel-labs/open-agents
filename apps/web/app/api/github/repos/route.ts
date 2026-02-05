import { NextRequest, NextResponse } from "next/server";
import { getCachedGitHubRepos } from "@/lib/github/cached-api";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  const token = await getUserGitHubToken();

  if (!token) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner");
  const limitParam = searchParams.get("limit");
  const queryParam = searchParams.get("query");

  if (!owner) {
    return NextResponse.json(
      { error: "Owner parameter is required" },
      { status: 400 },
    );
  }

  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const limit =
    typeof parsedLimit === "number" && Number.isFinite(parsedLimit)
      ? parsedLimit
      : undefined;
  const query = queryParam?.trim() || undefined;

  try {
    const repos = await getCachedGitHubRepos(session.user.id, token, owner, {
      limit,
      query,
    });

    if (!repos) {
      return NextResponse.json(
        { error: "Failed to fetch repositories" },
        { status: 500 },
      );
    }

    return NextResponse.json(repos);
  } catch (error) {
    console.error("Error fetching repositories:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 },
    );
  }
}
