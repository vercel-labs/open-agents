"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { DiffResponse } from "@/app/api/tasks/[id]/diff/route";
import type { CachedDiffResponse } from "@/app/api/tasks/[id]/diff/cached/route";

export interface UseTaskDiffOptions {
  /** Initial cached diff data to show while loading */
  initialData?: DiffResponse | null;
  /** Initial cached timestamp */
  initialCachedAt?: Date | null;
}

export interface UseTaskDiffReturn {
  diff: DiffResponse | null;
  isLoading: boolean;
  error: string | null;
  /** Whether the data is from cache (sandbox offline) */
  isStale: boolean;
  /** When the cached data was saved */
  cachedAt: Date | null;
  /** Trigger a refresh */
  refresh: () => Promise<DiffResponse | undefined>;
}

export function useTaskDiff(
  taskId: string,
  sandboxConnected: boolean,
  options?: UseTaskDiffOptions,
): UseTaskDiffReturn {
  // Primary: fetch from live sandbox when connected
  const {
    data: liveData,
    error: liveError,
    isLoading: liveLoading,
    mutate: mutateLive,
  } = useSWR<DiffResponse>(
    sandboxConnected ? `/api/tasks/${taskId}/diff` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // Don't show stale data when reconnecting - let the cached endpoint handle it
      revalidateIfStale: true,
    },
  );

  // Fallback: fetch cached diff when sandbox disconnected
  const {
    data: cachedData,
    error: cachedError,
    isLoading: cachedLoading,
  } = useSWR<CachedDiffResponse>(
    !sandboxConnected ? `/api/tasks/${taskId}/diff/cached` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  // Determine which data to use
  if (sandboxConnected) {
    return {
      diff: liveData ?? options?.initialData ?? null,
      isLoading: liveLoading,
      error: liveError?.message ?? null,
      isStale: false,
      cachedAt: null,
      refresh: mutateLive,
    };
  }

  // Sandbox disconnected - use cached data
  if (cachedData) {
    return {
      diff: cachedData.data,
      isLoading: false,
      error: null,
      isStale: true,
      cachedAt: new Date(cachedData.cachedAt),
      refresh: async () => undefined,
    };
  }

  // Use initial data while loading cached
  if (cachedLoading && options?.initialData) {
    return {
      diff: options.initialData,
      isLoading: true,
      error: null,
      isStale: true,
      cachedAt: options.initialCachedAt ?? null,
      refresh: async () => undefined,
    };
  }

  // No cached data available
  return {
    diff: options?.initialData ?? null,
    isLoading: cachedLoading,
    error:
      cachedError?.message ??
      (!cachedLoading && !options?.initialData
        ? "No sandbox available and no cached diff"
        : null),
    isStale: !!options?.initialData,
    cachedAt: options?.initialCachedAt ?? null,
    refresh: async () => undefined,
  };
}
