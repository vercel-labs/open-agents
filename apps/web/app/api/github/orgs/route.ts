import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { fetchGitHubOrgs } from "@/lib/github/api";

export async function GET() {
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

  try {
    const orgs = await fetchGitHubOrgs(token);

    if (!orgs) {
      return NextResponse.json(
        { error: "Failed to fetch organizations" },
        { status: 500 },
      );
    }

    return NextResponse.json(orgs);
  } catch (error) {
    console.error("Error fetching organizations:", error);
    return NextResponse.json(
      { error: "Failed to fetch organizations" },
      { status: 500 },
    );
  }
}
