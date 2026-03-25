"use client";

import useSWR from "swr";
import type { LeaderboardRankResponse } from "@/app/api/usage/rank/route";
import { fetcher } from "@/lib/swr";

export function useLeaderboardRank() {
  const { data, isLoading } = useSWR<LeaderboardRankResponse | null>(
    "/api/usage/rank",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5 * 60 * 1000,
    },
  );

  return { rank: data ?? null, loading: isLoading };
}
