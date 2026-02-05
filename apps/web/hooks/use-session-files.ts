"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import type { FilesResponse } from "@/app/api/sessions/[sessionId]/files/route";

export interface UseSessionFilesReturn {
  files: FilesResponse["files"] | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<FilesResponse | undefined>;
}

export function useSessionFiles(
  sessionId: string,
  sandboxConnected: boolean,
): UseSessionFilesReturn {
  const { data, error, isLoading, mutate } = useSWR<FilesResponse>(
    sandboxConnected ? `/api/sessions/${sessionId}/files` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    files: data?.files ?? null,
    isLoading,
    error: error?.message ?? null,
    refresh: mutate,
  };
}
