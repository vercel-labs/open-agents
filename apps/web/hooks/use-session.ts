"use client";

import useSWR from "swr";
import type { SessionUserInfo } from "@/lib/session/types";
import { fetcherNoStore } from "@/lib/swr";

export function useSession() {
  const { data, isLoading, mutate } = useSWR<SessionUserInfo>(
    "/api/auth/info",
    fetcherNoStore,
    {
      revalidateOnFocus: true,
    },
  );

  return {
    session: data ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    hasGitHub: data?.hasGitHub ?? false,
    hasGitHubAccount: data?.hasGitHubAccount ?? false,
    hasGitHubInstallations: data?.hasGitHubInstallations ?? false,
    refresh: mutate,
  };
}
