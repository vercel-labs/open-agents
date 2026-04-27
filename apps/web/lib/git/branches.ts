export interface RepoBranchesResponse {
  branches: string[];
  defaultBranch: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchRepoBranches(
  owner: string,
  repo: string,
): Promise<RepoBranchesResponse> {
  const response = await fetch(
    `/api/github/branches?owner=${owner}&repo=${repo}`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch branches");
  }

  const data: unknown = await response.json();
  if (!isRecord(data)) {
    throw new Error("Invalid branches response");
  }

  const branches = Array.isArray(data.branches)
    ? data.branches.filter(
        (branch): branch is string => typeof branch === "string",
      )
    : [];
  const defaultBranch =
    typeof data.defaultBranch === "string" ? data.defaultBranch : "main";

  return { branches, defaultBranch };
}
