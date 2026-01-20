"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type {
  FileSuggestion,
  FilesResponse,
} from "@/app/api/tasks/[id]/files/route";

export interface UseTaskFilesReturn {
  files: FileSuggestion[] | null;
  isLoading: boolean;
  error: string | null;
  /** Trigger a refresh */
  refresh: () => Promise<FilesResponse | undefined>;
}

export function useTaskFiles(
  taskId: string,
  sandboxConnected: boolean,
): UseTaskFilesReturn {
  const { data, error, isLoading, mutate } = useSWR<FilesResponse>(
    sandboxConnected ? `/api/tasks/${taskId}/files` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  // When sandbox is disconnected, return null state without an error.
  // This distinguishes "no sandbox to fetch from" from "fetch failed".
  if (!sandboxConnected) {
    return {
      files: null,
      isLoading: false,
      error: null,
      refresh: async () => undefined,
    };
  }

  return {
    files: data?.files ?? null,
    isLoading,
    error: error?.message ?? null,
    refresh: mutate,
  };
}
