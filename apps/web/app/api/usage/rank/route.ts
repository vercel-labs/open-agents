import type { NextRequest } from "next/server";
import { getUsageDomainLeaderboard } from "@/lib/db/usage-domain-leaderboard";
import { getSessionFromReq } from "@/lib/session/server";
import { formatDateOnly } from "@/lib/usage/date-range";

export interface LeaderboardRankResponse {
  rank: number;
  total: number;
  domain: string;
}

/**
 * GET /api/usage/rank — Return the current user's daily rank in their domain leaderboard.
 * Returns `null` JSON body when the user has no eligible domain.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const today = formatDateOnly(new Date());
    const leaderboard = await getUsageDomainLeaderboard(session.user.email, {
      range: { from: today, to: today },
    });
    if (!leaderboard || leaderboard.rows.length === 0) {
      return Response.json(null);
    }

    const rankIndex = leaderboard.rows.findIndex(
      (row) => row.userId === session.user.id,
    );

    if (rankIndex === -1) {
      return Response.json(null);
    }

    const result: LeaderboardRankResponse = {
      rank: rankIndex + 1,
      total: leaderboard.rows.length,
      domain: leaderboard.domain,
    };

    return Response.json(result);
  } catch (error) {
    console.error("Failed to get leaderboard rank:", error);
    return Response.json(
      { error: "Failed to get leaderboard rank" },
      { status: 500 },
    );
  }
}
