import { z } from "zod";

const INSTALLATION_REPOS_MAX_PAGES = 20;
const INSTALLATION_REPOS_PER_PAGE = 25;

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

interface ListAccessibleInstallationRepositoriesByNamesOptions {
  installationId: number;
  userToken: string;
  owner?: string;
  names: string[];
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

async function fetchInstallationRepositoriesPage(params: {
  installationId: number;
  userToken: string;
  page: number;
  perPage?: number;
}): Promise<z.infer<typeof installationReposResponseSchema>> {
  const endpoint = new URL(
    `https://api.github.com/user/installations/${params.installationId}/repositories`,
  );
  endpoint.searchParams.set(
    "per_page",
    `${params.perPage ?? INSTALLATION_REPOS_PER_PAGE}`,
  );
  endpoint.searchParams.set("page", `${params.page}`);

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${params.userToken}`,
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

  return parsed.data;
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
  const matchedRepos: z.infer<typeof installationRepoSchema>[] = [];

  for (let page = 1; page <= INSTALLATION_REPOS_MAX_PAGES; page++) {
    const data = await fetchInstallationRepositoriesPage({
      installationId,
      userToken,
      page,
    });

    if (data.repositories.length === 0) {
      break;
    }

    const pageMatches = data.repositories.filter((repo) => {
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

    if (data.repositories.length < INSTALLATION_REPOS_PER_PAGE) {
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

export async function listAccessibleInstallationRepositoriesByNames({
  installationId,
  userToken,
  owner,
  names,
}: ListAccessibleInstallationRepositoriesByNamesOptions): Promise<
  InstallationRepository[]
> {
  const ownerFilter = owner?.trim().toLowerCase();
  const orderedNames = names
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const requestedOrder = new Map<string, number>();

  for (const name of orderedNames) {
    const normalizedName = name.toLowerCase();
    if (!requestedOrder.has(normalizedName)) {
      requestedOrder.set(normalizedName, requestedOrder.size);
    }
  }

  if (requestedOrder.size === 0) {
    return [];
  }

  const foundRepos = new Map<string, InstallationRepository>();

  for (let page = 1; page <= INSTALLATION_REPOS_MAX_PAGES; page++) {
    const data = await fetchInstallationRepositoriesPage({
      installationId,
      userToken,
      page,
    });

    if (data.repositories.length === 0) {
      break;
    }

    for (const repo of data.repositories) {
      if (ownerFilter && repo.owner.login.toLowerCase() !== ownerFilter) {
        continue;
      }

      const normalizedName = repo.name.toLowerCase();
      if (
        requestedOrder.has(normalizedName) &&
        !foundRepos.has(normalizedName)
      ) {
        foundRepos.set(normalizedName, {
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          private: repo.private,
          clone_url: repo.clone_url,
          updated_at: repo.updated_at,
          language: repo.language,
        });
      }
    }

    if (foundRepos.size >= requestedOrder.size) {
      break;
    }

    if (data.repositories.length < INSTALLATION_REPOS_PER_PAGE) {
      break;
    }
  }

  return [...foundRepos.entries()]
    .toSorted(
      ([nameA], [nameB]) =>
        (requestedOrder.get(nameA) ?? Number.MAX_SAFE_INTEGER) -
        (requestedOrder.get(nameB) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([, repo]) => repo);
}

export async function isInstallationRepositoryAccessible(params: {
  installationId: number;
  userToken: string;
  owner?: string;
  name: string;
}): Promise<boolean> {
  const repos = await listAccessibleInstallationRepositoriesByNames({
    installationId: params.installationId,
    userToken: params.userToken,
    owner: params.owner,
    names: [params.name],
  });

  return repos.length > 0;
}
