import { NextRequest, NextResponse } from "next/server";
import { getCachedGitHubBranches } from "@/lib/github/cached-api";
import { getRepoToken } from "@/lib/github/get-repo-token";
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
  const repo = searchParams.get("repo");

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Owner and repo parameters are required" },
      { status: 400 },
    );
  }

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
    const result = await getCachedGitHubBranches(
      session.user.id,
      tokenResult.token,
      owner,
      repo,
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to fetch branches" },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching branches:", error);
    return NextResponse.json(
      { error: "Failed to fetch branches" },
      { status: 500 },
    );
  }
}
