"use client";

import useSWR from "swr";
import type { GitHubConnectionStatusResponse } from "@/lib/github/connection-status";
import { fetcherNoStore } from "@/lib/swr";
import { useSession } from "./use-session";

interface UseGitHubConnectionStatusOptions {
  enabled?: boolean;
}

export function useGitHubConnectionStatus(
  options?: UseGitHubConnectionStatusOptions,
) {
  const { isAuthenticated, hasGitHub } = useSession();
  const enabled = options?.enabled ?? true;
  const shouldFetch = enabled && isAuthenticated && hasGitHub;

  const { data, error, isLoading, mutate } =
    useSWR<GitHubConnectionStatusResponse>(
      shouldFetch ? "/api/github/connection-status" : null,
      fetcherNoStore,
      {
        dedupingInterval: 30_000,
        revalidateOnFocus: true,
      },
    );

  return {
    data: data ?? null,
    status: data?.status ?? (shouldFetch ? null : "not_connected"),
    reason: data?.reason ?? null,
    hasInstallations: data?.hasInstallations ?? false,
    reconnectRequired: data?.status === "reconnect_required",
    isLoading: shouldFetch && isLoading,
    error: error instanceof Error ? error.message : null,
    refresh: mutate,
  };
}
