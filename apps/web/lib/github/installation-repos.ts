import { z } from "zod";

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

export interface InstallationRepository {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  updated_at: string;
  language: string | null;
}

interface ListUserInstallationRepositoriesOptions {
  installationId: number;
  userToken: string;
  owner?: string;
  query?: string;
  limit?: number;
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

/**
 * List repositories accessible to the user through a specific GitHub App
 * installation. Uses the user's OAuth token so GitHub computes the
 * intersection of repos the app can see and repos the user can see.
 */
export async function listUserInstallationRepositories({
  installationId,
  userToken,
  owner,
  query,
  limit,
}: ListUserInstallationRepositoriesOptions): Promise<InstallationRepository[]> {
  const ownerFilter = owner?.trim().toLowerCase();
  const queryFilter = query?.trim().toLowerCase();
  const normalizedLimit = normalizeLimit(limit);

  const perPage = 25;
  const maxPages = INSTALLATION_REPOS_MAX_PAGES;
  const matchedRepos: z.infer<typeof installationRepoSchema>[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const endpoint = new URL(
      `https://api.github.com/user/installations/${installationId}/repositories`,
    );
    endpoint.searchParams.set("per_page", `${perPage}`);
    endpoint.searchParams.set("page", `${page}`);

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to fetch user installation repositories: ${response.status} ${body}`,
      );
    }

    const json = await response.json();
    const parsed = installationReposResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Invalid GitHub user installation repositories response");
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

    if (matchedRepos.length >= normalizedLimit) {
      break;
    }

    if (parsed.data.repositories.length < perPage) {
      break;
    }
  }

  matchedRepos.sort(compareRepositoriesByRecentActivity);

  return matchedRepos.slice(0, normalizedLimit).map((repo) => ({
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    clone_url: repo.clone_url,
    updated_at: repo.updated_at,
    language: repo.language,
  }));
}
