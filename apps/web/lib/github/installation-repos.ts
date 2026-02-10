import { z } from "zod";

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

export interface InstallationRepository {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  updated_at: string;
  language: string | null;
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(limit, 100));
}

export async function listInstallationRepositories(
  token: string,
  options?: ListInstallationRepositoriesOptions,
): Promise<InstallationRepository[]> {
  const allRepos: z.infer<typeof installationRepoSchema>[] = [];
  const perPage = 100;
  const maxPages = 20;

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

    allRepos.push(...parsed.data.repositories);

    if (parsed.data.repositories.length < perPage) {
      break;
    }
  }

  const ownerFilter = options?.owner?.trim().toLowerCase();
  const queryFilter = options?.query?.trim().toLowerCase();
  const limit = normalizeLimit(options?.limit);

  const filtered = allRepos.filter((repo) => {
    const matchesOwner = ownerFilter
      ? repo.owner.login.toLowerCase() === ownerFilter
      : true;

    const matchesQuery = queryFilter
      ? repo.name.toLowerCase().includes(queryFilter)
      : true;

    return matchesOwner && matchesQuery;
  });

  filtered.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  return filtered.slice(0, limit).map((repo) => ({
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    clone_url: repo.clone_url,
    updated_at: repo.updated_at,
    language: repo.language,
  }));
}
