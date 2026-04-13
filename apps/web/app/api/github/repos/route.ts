import { NextRequest, NextResponse } from "next/server";
import { getCachedGitHubRepos } from "@/lib/github/cached-api";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { fetchInstallationRepositoriesByInstallation } from "@/lib/github/installation-repos";
import { getServerSession } from "@/lib/session/get-server-session";

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

  let tokenResult: Awaited<ReturnType<typeof getRepoToken>>;
  try {
    tokenResult = await getRepoToken(session.user.id, owner);
  } catch {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  try {
    if (tokenResult.type === "installation") {
      const repos = await fetchInstallationRepositoriesByInstallation(
        tokenResult.installationId,
        owner,
        query,
        limit,
      );

      return NextResponse.json(repos);
    }

    const repos = await getCachedGitHubRepos(
      session.user.id,
      tokenResult.token,
      owner,
      {
        limit,
        query,
      },
    );

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
