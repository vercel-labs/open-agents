"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { SessionUserInfo } from "@/lib/session/types";

export function useSession() {
  const { data, isLoading } = useSWR<SessionUserInfo>(
    "/api/auth/info",
    fetcher,
    {
      revalidateOnFocus: true,
      fallbackData: { user: undefined },
    },
  );

  return {
    session: data ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    hasGitHub: data?.hasGitHub ?? false,
  };
}
