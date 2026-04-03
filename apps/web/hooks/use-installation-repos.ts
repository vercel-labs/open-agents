"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { z } from "zod";
import { fetcher } from "@/lib/swr";

const installationRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  updated_at: z.string().optional(),
});

const installationReposSchema = z.array(installationRepoSchema);

export type InstallationRepo = z.infer<typeof installationRepoSchema>;

interface UseInstallationReposOptions {
  installationId: number | null;
  query?: string;
  limit?: number;
}

interface UseInstallationReposReturn {
  repos: InstallationRepo[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<InstallationRepo[] | undefined>;
}

async function fetchInstallationRepos(
  url: string,
): Promise<InstallationRepo[]> {
  const json = await fetcher<unknown>(url);
  const parsed = installationReposSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid repositories response");
  }

  return parsed.data;
}

export function useInstallationRepos({
  installationId,
  query,
  limit = 50,
}: UseInstallationReposOptions): UseInstallationReposReturn {
  const reposUrl = useMemo(() => {
    if (!installationId) {
      return null;
    }

    const params = new URLSearchParams({
      installation_id: `${installationId}`,
      limit: `${limit}`,
    });

    const normalizedQuery = query?.trim();
    if (normalizedQuery) {
      params.set("query", normalizedQuery);
    }

    return `/api/github/installations/repos?${params.toString()}`;
  }, [installationId, query, limit]);

  const { data, error, isLoading, mutate } = useSWR<InstallationRepo[]>(
    reposUrl,
    fetchInstallationRepos,
    {
      dedupingInterval: 5_000,
    },
  );

  const refresh = useCallback(async () => {
    if (!reposUrl) {
      return undefined;
    }

    const refreshUrl = `${reposUrl}&refresh=1`;
    const freshRepos = await fetchInstallationRepos(refreshUrl);
    await mutate(freshRepos, { revalidate: false });

    return freshRepos;
  }, [reposUrl, mutate]);

  return {
    repos: data ?? [],
    isLoading,
    error: error?.message ?? null,
    refresh,
  };
}
