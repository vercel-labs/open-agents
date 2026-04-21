"use client";

import useSWR from "swr";
import type { LeaderboardRankResponse } from "@/app/api/usage/rank/route";
import { fetcher } from "@/lib/swr";

export const LEADERBOARD_RANK_SWR_KEY = "/api/usage/rank";

export function useLeaderboardRank() {
  const { data, isLoading } = useSWR<LeaderboardRankResponse | null>(
    LEADERBOARD_RANK_SWR_KEY,
    fetcher,
    {
      dedupingInterval: 30_000,
    },
  );

  return { rank: data ?? null, loading: isLoading };
}
