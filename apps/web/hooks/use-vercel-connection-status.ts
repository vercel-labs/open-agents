"use client";

import useSWR from "swr";
import { fetcherNoStore } from "@/lib/swr";
import {
  VERCEL_CONNECTION_STATUS_DEDUPING_INTERVAL_MS,
  type VercelConnectionStatusResponse,
} from "@/lib/vercel/connection-status";
import { useSession } from "./use-session";

interface UseVercelConnectionStatusOptions {
  enabled?: boolean;
}

export function useVercelConnectionStatus(
  options?: UseVercelConnectionStatusOptions,
) {
  const { session, isAuthenticated } = useSession();
  const enabled = options?.enabled ?? true;
  const shouldFetch =
    enabled && isAuthenticated && session?.authProvider === "vercel";

  const { data, error, isLoading, mutate } =
    useSWR<VercelConnectionStatusResponse>(
      shouldFetch ? "/api/vercel/connection-status" : null,
      fetcherNoStore,
      {
        dedupingInterval: VERCEL_CONNECTION_STATUS_DEDUPING_INTERVAL_MS,
        revalidateOnFocus: true,
      },
    );

  return {
    data: data ?? null,
    status: data?.status ?? (shouldFetch ? null : "connected"),
    reason: data?.reason ?? null,
    reconnectRequired: data?.status === "reconnect_required",
    isLoading: shouldFetch && isLoading,
    error: error instanceof Error ? error.message : null,
    refresh: mutate,
  };
}
