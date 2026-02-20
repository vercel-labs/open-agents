"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { SkillsResponse } from "@/app/api/sessions/[sessionId]/skills/route";

export interface UseSessionSkillsReturn {
  skills: SkillsResponse["skills"] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<SkillsResponse | undefined>;
}

export function useSessionSkills(
  sessionId: string,
  sandboxConnected: boolean,
): UseSessionSkillsReturn {
  const { data, error, isLoading, mutate } = useSWR<SkillsResponse>(
    sandboxConnected ? `/api/sessions/${sessionId}/skills` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    skills: data?.skills ?? null,
    isLoading,
    error: error?.message ?? null,
    refresh: mutate,
  };
}
