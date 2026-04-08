import { unstable_cache } from "next/cache";
import { z } from "zod";
import { getInstallationToken } from "@/lib/github/app-auth";

const CACHE_REVALIDATE_SECONDS = 120;
const INSTALLATION_REPOS_MAX_PAGES = 20;

const installationRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  clone_url: z.string().url(),
  updated_at: z.string(),
  language: z.string().nullable(),
  owner: z.object({
    login: z.string(),
  }),
});

const installationReposResponseSchema = z.object({
  repositories: z.array(installationRepoSchema),
});

interface ListInstallationRepositoriesOptions {
  owner?: string;
  query?: string;
  limit?: number;
}

interface FetchInstallationRepositoriesOptions {
  installationId: number;
  owner?: string;
  query?: string;
  limit?: number;
}

export interface InstallationRepository {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  updated_at: string;
  language: string | null;
}

export function getInstallationReposCacheTag(installationId: number): string {
  return `github-installation-repos-${installationId}`;
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(limit, 100));
}

function compareRepositoriesByRecentActivity(
  a: Pick<InstallationRepository, "name" | "updated_at">,
  b: Pick<InstallationRepository, "name" | "updated_at">,
): number {
  const updatedAtA = Date.parse(a.updated_at);
  const updatedAtB = Date.parse(b.updated_at);
  const hasValidUpdatedAtA = Number.isFinite(updatedAtA);
  const hasValidUpdatedAtB = Number.isFinite(updatedAtB);

  if (hasValidUpdatedAtA && hasValidUpdatedAtB && updatedAtA !== updatedAtB) {
    return updatedAtB - updatedAtA;
  }

  if (hasValidUpdatedAtA !== hasValidUpdatedAtB) {
    return hasValidUpdatedAtA ? -1 : 1;
  }

  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

export async function listInstallationRepositories(
  token: string,
  options?: ListInstallationRepositoriesOptions,
): Promise<InstallationRepository[]> {
  const ownerFilter = options?.owner?.trim().toLowerCase();
  const queryFilter = options?.query?.trim().toLowerCase();
  const limit = normalizeLimit(options?.limit);

  const perPage = 100;
  const maxPages = INSTALLATION_REPOS_MAX_PAGES;
  const matchedRepos: z.infer<typeof installationRepoSchema>[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const endpoint = `https://api.github.com/installation/repositories?per_page=${perPage}&page=${page}`;
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to fetch installation repositories: ${response.status} ${body}`,
      );
    }

    const json = await response.json();
    const parsed = installationReposResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Invalid GitHub installation repositories response");
    }

    if (parsed.data.repositories.length === 0) {
      break;
    }

    const pageMatches = parsed.data.repositories.filter((repo) => {
      const matchesOwner = ownerFilter
        ? repo.owner.login.toLowerCase() === ownerFilter
        : true;

      const matchesQuery = queryFilter
        ? repo.name.toLowerCase().includes(queryFilter)
        : true;

      return matchesOwner && matchesQuery;
    });

    matchedRepos.push(...pageMatches);

    if (parsed.data.repositories.length < perPage) {
      break;
    }
  }

  matchedRepos.sort(compareRepositoriesByRecentActivity);

  return matchedRepos.slice(0, limit).map((repo) => ({
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    clone_url: repo.clone_url,
    updated_at: repo.updated_at,
    language: repo.language,
  }));
}

async function fetchInstallationRepositoriesByInstallation(
  installationId: number,
  owner?: string,
  query?: string,
  limit?: number,
): Promise<InstallationRepository[]> {
  const token = await getInstallationToken(installationId);
  return listInstallationRepositories(token, {
    owner,
    query,
    limit,
  });
}

export function getCachedInstallationRepositories({
  installationId,
  owner,
  query,
  limit,
}: FetchInstallationRepositoriesOptions): Promise<InstallationRepository[]> {
  const cachedFn = unstable_cache(
    fetchInstallationRepositoriesByInstallation,
    ["github-installation-repos"],
    {
      revalidate: CACHE_REVALIDATE_SECONDS,
      tags: [getInstallationReposCacheTag(installationId)],
    },
  );

  return cachedFn(installationId, owner, query, limit);
}
