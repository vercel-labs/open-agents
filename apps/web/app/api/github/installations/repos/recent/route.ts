import { NextRequest, NextResponse } from "next/server";
import { getInstallationByUserAndId } from "@/lib/db/installations";
import { getRecentReposByUserId } from "@/lib/db/recent-repos";
import { listAccessibleInstallationRepositoriesByNames } from "@/lib/github/installation-repos";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

function parseInstallationId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const installationId = parseInstallationId(
    searchParams.get("installation_id"),
  );
  const limit = parseLimit(searchParams.get("limit"));

  if (!installationId) {
    return NextResponse.json(
      { error: "installation_id is required" },
      { status: 400 },
    );
  }

  const installation = await getInstallationByUserAndId(
    session.user.id,
    installationId,
  );
  if (!installation) {
    return NextResponse.json(
      { error: "Installation not found" },
      { status: 403 },
    );
  }

  const userToken = await getUserGitHubToken(session.user.id);
  if (!userToken) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  try {
    const recentRepos = await getRecentReposByUserId(session.user.id, {
      owner: installation.accountLogin,
      limit,
    });

    if (recentRepos.length === 0) {
      return NextResponse.json([]);
    }

    const accessibleRepos = await listAccessibleInstallationRepositoriesByNames(
      {
        installationId,
        userToken,
        owner: installation.accountLogin,
        names: recentRepos.map((repo) => repo.repo),
      },
    );
    const recentByName = new Map(
      recentRepos.map((repo) => [repo.repo.toLowerCase(), repo]),
    );

    return NextResponse.json(
      accessibleRepos.flatMap((repo) => {
        const recentRepo = recentByName.get(repo.name.toLowerCase());
        if (!recentRepo) {
          return [];
        }

        return [
          {
            ...repo,
            last_used_at: recentRepo.lastUsedAt.toISOString(),
          },
        ];
      }),
    );
  } catch (error) {
    console.error("Failed to fetch recent installation repositories:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent repositories" },
      { status: 500 },
    );
  }
}
