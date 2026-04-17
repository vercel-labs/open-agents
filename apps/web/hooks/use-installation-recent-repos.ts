"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { z } from "zod";
import { fetcher } from "@/lib/swr";

const recentInstallationRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  updated_at: z.string(),
  last_used_at: z.string(),
});

const recentInstallationReposSchema = z.array(recentInstallationRepoSchema);

export type RecentInstallationRepo = z.infer<
  typeof recentInstallationRepoSchema
>;

interface UseInstallationRecentReposOptions {
  installationId: number | null;
  limit?: number;
  enabled?: boolean;
}

async function fetchRecentInstallationRepos(
  url: string,
): Promise<RecentInstallationRepo[]> {
  const json = await fetcher<unknown>(url);
  const parsed = recentInstallationReposSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid recent repositories response");
  }

  return parsed.data;
}

export function useInstallationRecentRepos({
  installationId,
  limit = 5,
  enabled = true,
}: UseInstallationRecentReposOptions) {
  const reposUrl = useMemo(() => {
    if (!enabled || !installationId) {
      return null;
    }

    const params = new URLSearchParams({
      installation_id: `${installationId}`,
      limit: `${limit}`,
    });

    return `/api/github/installations/repos/recent?${params.toString()}`;
  }, [enabled, installationId, limit]);

  const { data, error, isLoading } = useSWR<RecentInstallationRepo[]>(
    reposUrl,
    fetchRecentInstallationRepos,
    {
      dedupingInterval: 5_000,
    },
  );

  return {
    repos: data ?? [],
    isLoading,
    error: error?.message ?? null,
  };
}
