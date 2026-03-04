import "server-only";

const VERCEL_API_BASE = "https://api.vercel.com";

export interface VercelProjectInfo {
  projectId: string;
  projectName: string;
  orgId: string;
  orgSlug?: string;
}

export type ResolutionFailureReason =
  | "no_vercel_auth"
  | "no_repo_context"
  | "project_unresolved"
  | "project_ambiguous"
  | "api_error";

export type ProjectResolutionResult =
  | { ok: true; project: VercelProjectInfo }
  | { ok: false; reason: ResolutionFailureReason; message?: string };

interface VercelProjectResponse {
  id: string;
  name: string;
  accountId: string;
  link?: {
    type?: string;
    org?: string;
    repo?: string;
    repoId?: number;
  };
}

interface VercelProjectsListResponse {
  projects: VercelProjectResponse[];
}

/**
 * Resolve a Vercel project from a GitHub repository.
 *
 * Calls the Vercel API to find projects linked to the given repo.
 * Returns the project info if exactly one match is found.
 */
export async function resolveVercelProject(params: {
  vercelToken: string;
  repoOwner: string;
  repoName: string;
}): Promise<ProjectResolutionResult> {
  const { vercelToken, repoOwner, repoName } = params;

  try {
    const url = new URL(`${VERCEL_API_BASE}/v10/projects`);
    url.searchParams.set("repo", `${repoOwner}/${repoName}`);
    url.searchParams.set("repoType", "github");

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[Vercel] Project resolution API error (${response.status}): ${text}`,
      );
      return {
        ok: false,
        reason: "api_error",
        message: `Vercel API returned ${response.status}`,
      };
    }

    const data = (await response.json()) as VercelProjectsListResponse;
    const projects = data.projects ?? [];

    if (projects.length === 0) {
      return {
        ok: false,
        reason: "project_unresolved",
        message: `No Vercel project found for ${repoOwner}/${repoName}`,
      };
    }

    if (projects.length > 1) {
      return {
        ok: false,
        reason: "project_ambiguous",
        message: `Found ${projects.length} Vercel projects for ${repoOwner}/${repoName}`,
      };
    }

    const project = projects[0]!;
    return {
      ok: true,
      project: {
        projectId: project.id,
        projectName: project.name,
        orgId: project.accountId,
        orgSlug: project.link?.org,
      },
    };
  } catch (error) {
    console.error("[Vercel] Project resolution failed:", error);
    return {
      ok: false,
      reason: "api_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
