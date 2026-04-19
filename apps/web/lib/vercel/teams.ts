import "server-only";
import { fetchVercelApi } from "./api-client";

export interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar: string | null;
  membership: {
    role: string;
  };
  createdAt: number;
}

interface VercelTeamsApiResponse {
  teams: Array<{
    id?: string;
    slug?: string;
    name?: string;
    avatar?: string | null;
    membership?: { role?: string };
    createdAt?: number;
  }>;
}

/**
 * List all Vercel teams the user has access to.
 * Returns teams sorted by name.
 */
export async function listVercelTeams(token: string): Promise<VercelTeam[]> {
  const response = await fetchVercelApi<VercelTeamsApiResponse>({
    path: "/v2/teams",
    token,
    query: new URLSearchParams({ limit: "100" }),
  });

  return (response.teams ?? [])
    .filter(
      (
        team,
      ): team is Required<
        Pick<(typeof response.teams)[number], "id" | "slug" | "name">
      > &
        (typeof response.teams)[number] =>
        typeof team.id === "string" &&
        team.id.length > 0 &&
        typeof team.slug === "string" &&
        team.slug.length > 0 &&
        typeof team.name === "string" &&
        team.name.length > 0,
    )
    .map((team) => ({
      id: team.id,
      slug: team.slug,
      name: team.name,
      avatar: team.avatar ?? null,
      membership: {
        role: team.membership?.role ?? "VIEWER",
      },
      createdAt: team.createdAt ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get details for a specific Vercel team.
 */
export async function getVercelTeam(
  token: string,
  teamId: string,
): Promise<VercelTeam | null> {
  try {
    const team = await fetchVercelApi<{
      id?: string;
      slug?: string;
      name?: string;
      avatar?: string | null;
      membership?: { role?: string };
      createdAt?: number;
    }>({
      path: `/v2/teams/${encodeURIComponent(teamId)}`,
      token,
    });

    if (!team.id || !team.slug || !team.name) {
      return null;
    }

    return {
      id: team.id,
      slug: team.slug,
      name: team.name,
      avatar: team.avatar ?? null,
      membership: {
        role: team.membership?.role ?? "VIEWER",
      },
      createdAt: team.createdAt ?? 0,
    };
  } catch {
    return null;
  }
}
