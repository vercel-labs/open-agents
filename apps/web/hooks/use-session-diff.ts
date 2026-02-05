"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { DiffResponse } from "@/app/api/sessions/[sessionId]/diff/route";
import type { CachedDiffResponse } from "@/app/api/sessions/[sessionId]/diff/cached/route";

export interface UseSessionDiffOptions {
  /** Initial cached diff data to show while loading */
  initialData?: DiffResponse | null;
  /** Initial cached timestamp */
  initialCachedAt?: Date | null;
}

export interface UseSessionDiffReturn {
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

export function useSessionDiff(
  sessionId: string,
  sandboxConnected: boolean,
  options?: UseSessionDiffOptions,
): UseSessionDiffReturn {
  const {
    data: liveData,
    error: liveError,
    isLoading: liveLoading,
    mutate: mutateLive,
  } = useSWR<DiffResponse>(
    sandboxConnected ? `/api/sessions/${sessionId}/diff` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: true,
    },
  );

  const {
    data: cachedData,
    error: cachedError,
    isLoading: cachedLoading,
  } = useSWR<CachedDiffResponse>(
    !sandboxConnected ? `/api/sessions/${sessionId}/diff/cached` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

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
