"use client";

import useSWR from "swr";
import { getGitStatus, type SessionGitStatus } from "@/lib/git/queries/status";

export type { SessionGitStatus } from "@/lib/git/queries/status";

export interface UseSessionGitStatusReturn {
  gitStatus: SessionGitStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<SessionGitStatus | undefined>;
}

async function fetchGitStatus(sessionId: string): Promise<SessionGitStatus> {
  const result = await getGitStatus({ sessionId });
  if (!result) {
    throw new Error("Failed to fetch git status");
  }
  return result;
}

export function useSessionGitStatus(
  sessionId: string,
  sandboxConnected: boolean,
): UseSessionGitStatusReturn {
  const key = sandboxConnected ? (["git-status", sessionId] as const) : null;

  const { data, error, isLoading, mutate } = useSWR<SessionGitStatus>(
    key,
    async ([, id]: readonly [string, string]) => fetchGitStatus(id),
    {
      revalidateOnFocus: false,
      dedupingInterval: 1500,
    },
  );

  return {
    gitStatus: data ?? null,
    isLoading,
    error: error?.message ?? null,
    refresh: mutate,
  };
}
