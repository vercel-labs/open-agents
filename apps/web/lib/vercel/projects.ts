import "server-only";
import type { VercelProjectSelection } from "@/lib/vercel/types";

const VERCEL_API_BASE_URL = "https://api.vercel.com";

interface VercelTeam {
  id?: string;
  slug?: string;
}

interface VercelTeamsResponse {
  teams?: VercelTeam[];
}

interface VercelProject {
  id?: string;
  name?: string;
}

interface VercelProjectsResponse {
  projects?: VercelProject[];
}

export interface VercelProjectEnv {
  key?: string;
  value?: string;
  target?: string | string[];
  createdAt?: string | number;
  updatedAt?: string | number;
}

interface VercelProjectEnvsResponse {
  envs?: VercelProjectEnv[];
}

interface VercelProjectScope {
  teamId: string | null;
  teamSlug: string | null;
}

export interface DevelopmentEnvVar {
  key: string;
  value: string;
}

function createVercelApiError(message: string, details?: string): Error {
  return new Error(details ? `${message}: ${details}` : message);
}

async function fetchVercelJson<T>(params: {
  path: string;
  token: string;
  query?: URLSearchParams;
}): Promise<T> {
  const url = new URL(`${VERCEL_API_BASE_URL}${params.path}`);
  if (params.query) {
    url.search = params.query.toString();
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${params.token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw createVercelApiError(
      `Vercel API request failed with ${response.status}`,
      body,
    );
  }

  return response.json() as Promise<T>;
}

function normalizeGithubRepoUrl(repoOwner: string, repoName: string): string {
  return `https://github.com/${repoOwner}/${repoName}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeTargets(target: VercelProjectEnv["target"]): string[] {
  if (Array.isArray(target)) {
    return target
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase());
  }

  if (typeof target === "string") {
    return [target.toLowerCase()];
  }

  return [];
}

function getRecencyTimestamp(env: VercelProjectEnv): number {
  const updatedAt =
    typeof env.updatedAt === "number"
      ? env.updatedAt
      : typeof env.updatedAt === "string"
        ? Date.parse(env.updatedAt)
        : Number.NaN;
  const createdAt =
    typeof env.createdAt === "number"
      ? env.createdAt
      : typeof env.createdAt === "string"
        ? Date.parse(env.createdAt)
        : Number.NaN;

  if (!Number.isNaN(updatedAt) && !Number.isNaN(createdAt)) {
    return Math.max(updatedAt, createdAt);
  }

  if (!Number.isNaN(updatedAt)) {
    return updatedAt;
  }

  if (!Number.isNaN(createdAt)) {
    return createdAt;
  }

  return 0;
}

function compareDevelopmentEnvPrecedence(
  candidate: VercelProjectEnv,
  current: VercelProjectEnv,
): number {
  const candidateTargets = normalizeTargets(candidate.target);
  const currentTargets = normalizeTargets(current.target);
  if (candidateTargets.length !== currentTargets.length) {
    return candidateTargets.length - currentTargets.length;
  }

  return getRecencyTimestamp(current) - getRecencyTimestamp(candidate);
}

async function listAccessibleVercelTeams(
  token: string,
): Promise<VercelProjectScope[]> {
  const response = await fetchVercelJson<VercelTeamsResponse>({
    path: "/v2/teams",
    token,
    query: new URLSearchParams({ limit: "100" }),
  });

  return (response.teams ?? [])
    .filter((team): team is Required<Pick<VercelTeam, "id">> & VercelTeam =>
      isNonEmptyString(team.id),
    )
    .map((team) => ({
      teamId: team.id,
      teamSlug: isNonEmptyString(team.slug) ? team.slug : null,
    }));
}

async function listProjectsForScope(params: {
  token: string;
  repoUrl: string;
  scope: VercelProjectScope;
}): Promise<VercelProjectSelection[]> {
  const query = new URLSearchParams({
    limit: "100",
    repoUrl: params.repoUrl,
  });
  if (params.scope.teamId) {
    query.set("teamId", params.scope.teamId);
  }

  const response = await fetchVercelJson<VercelProjectsResponse>({
    path: "/v10/projects",
    token: params.token,
    query,
  });

  return (response.projects ?? [])
    .filter(
      (project): project is Required<Pick<VercelProject, "id" | "name">> =>
        isNonEmptyString(project.id) && isNonEmptyString(project.name),
    )
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      teamId: params.scope.teamId,
      teamSlug: params.scope.teamSlug,
    }));
}

export async function listMatchingVercelProjects(params: {
  token: string;
  repoOwner: string;
  repoName: string;
}): Promise<VercelProjectSelection[]> {
  const repoUrl = normalizeGithubRepoUrl(params.repoOwner, params.repoName);

  let teamScopes: VercelProjectScope[] = [];
  let teamListError: Error | null = null;
  try {
    teamScopes = await listAccessibleVercelTeams(params.token);
  } catch (error) {
    teamListError =
      error instanceof Error
        ? error
        : new Error("Failed to list accessible Vercel teams");
  }

  const scopes: VercelProjectScope[] = [
    { teamId: null, teamSlug: null },
    ...teamScopes,
  ];

  const results = await Promise.allSettled(
    scopes.map((scope) =>
      listProjectsForScope({
        token: params.token,
        repoUrl,
        scope,
      }),
    ),
  );

  const fulfilledResults = results.filter(
    (result): result is PromiseFulfilledResult<VercelProjectSelection[]> =>
      result.status === "fulfilled",
  );
  if (fulfilledResults.length === 0) {
    const firstScopeError = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw (
      firstScopeError?.reason ??
      teamListError ??
      new Error("Failed to list matching Vercel projects")
    );
  }

  const successfulMatches = fulfilledResults.flatMap((result) => result.value);
  const deduped = new Map<string, VercelProjectSelection>();
  for (const project of successfulMatches) {
    if (!deduped.has(project.projectId)) {
      deduped.set(project.projectId, project);
    }
  }

  return Array.from(deduped.values()).sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName) ||
      (left.teamSlug ?? "").localeCompare(right.teamSlug ?? "") ||
      left.projectId.localeCompare(right.projectId),
  );
}

export async function listVercelProjectEnvs(params: {
  token: string;
  projectIdOrName: string;
  teamId?: string | null;
}): Promise<VercelProjectEnv[]> {
  const query = new URLSearchParams({ decrypt: "true" });
  if (params.teamId) {
    query.set("teamId", params.teamId);
  }

  const response = await fetchVercelJson<VercelProjectEnvsResponse>({
    path: `/v10/projects/${encodeURIComponent(params.projectIdOrName)}/env`,
    token: params.token,
    query,
  });

  return response.envs ?? [];
}

export function selectDevelopmentEnvVars(
  envs: VercelProjectEnv[],
): DevelopmentEnvVar[] {
  const selectedByKey = new Map<string, VercelProjectEnv>();

  for (const env of envs) {
    if (!isNonEmptyString(env.key) || typeof env.value !== "string") {
      continue;
    }

    const targets = normalizeTargets(env.target);
    if (!targets.includes("development")) {
      continue;
    }

    const current = selectedByKey.get(env.key);
    if (!current || compareDevelopmentEnvPrecedence(env, current) < 0) {
      selectedByKey.set(env.key, env);
    }
  }

  return Array.from(selectedByKey.entries())
    .map(([key, env]) => ({ key, value: env.value ?? "" }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function serializeEnvVarsToDotenv(envVars: DevelopmentEnvVar[]): string {
  if (envVars.length === 0) {
    return "";
  }

  return `${envVars
    .map(({ key, value }) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

export async function buildDevelopmentDotenvFromVercelProject(params: {
  token: string;
  projectIdOrName: string;
  teamId?: string | null;
}): Promise<string> {
  const envs = await listVercelProjectEnvs(params);
  return serializeEnvVarsToDotenv(selectDevelopmentEnvVars(envs));
}

interface VercelDeployment {
  url?: string | null;
  defaultRoute?: string | null;
  inspectorUrl?: string | null;
  created?: number;
  createdAt?: number;
  ready?: number;
  state?: string;
  readyState?: string;
  target?: string | null;
}

interface VercelDeploymentsResponse {
  deployments?: VercelDeployment[];
}

function getDeploymentRecencyTimestamp(deployment: VercelDeployment): number {
  const timestamps = [
    deployment.ready,
    deployment.createdAt,
    deployment.created,
  ]
    .filter((value): value is number => typeof value === "number")
    .filter((value) => Number.isFinite(value));

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

function normalizeDeploymentBaseUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function getDeploymentUrl(deployment: VercelDeployment): string | null {
  if (!isNonEmptyString(deployment.url)) {
    return null;
  }

  const baseUrl = normalizeDeploymentBaseUrl(deployment.url.trim());
  const defaultRoute =
    typeof deployment.defaultRoute === "string"
      ? deployment.defaultRoute.trim()
      : "";

  if (!defaultRoute || defaultRoute === "/") {
    return baseUrl;
  }

  if (!defaultRoute.startsWith("/")) {
    return baseUrl;
  }

  return new URL(defaultRoute, baseUrl).toString();
}

export async function findLatestPreviewDeploymentUrlForBranch(params: {
  token: string;
  projectIdOrName: string;
  branch: string;
  teamId?: string | null;
}): Promise<string | null> {
  const branch = params.branch.trim();
  if (!branch) {
    return null;
  }

  const query = new URLSearchParams({
    projectId: params.projectIdOrName,
    branch,
    state: "READY",
    limit: "20",
  });
  if (params.teamId) {
    query.set("teamId", params.teamId);
  }

  const response = await fetchVercelJson<VercelDeploymentsResponse>({
    path: "/v6/deployments",
    token: params.token,
    query,
  });

  const latestDeployment = (response.deployments ?? [])
    .filter((deployment) => {
      if (!getDeploymentUrl(deployment)) {
        return false;
      }

      if ((deployment.readyState ?? deployment.state) !== "READY") {
        return false;
      }

      return deployment.target !== "production";
    })
    .sort(
      (left, right) =>
        getDeploymentRecencyTimestamp(right) -
        getDeploymentRecencyTimestamp(left),
    )[0];

  return latestDeployment ? getDeploymentUrl(latestDeployment) : null;
}

const BUILDING_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);
const ERROR_STATES = new Set(["ERROR", "CANCELED"]);

export async function findLatestBuildingDeploymentUrlForBranch(params: {
  token: string;
  projectIdOrName: string;
  branch: string;
  teamId?: string | null;
}): Promise<string | null> {
  const branch = params.branch.trim();
  if (!branch) {
    return null;
  }

  const query = new URLSearchParams({
    projectId: params.projectIdOrName,
    branch,
    limit: "5",
  });
  if (params.teamId) {
    query.set("teamId", params.teamId);
  }

  const response = await fetchVercelJson<VercelDeploymentsResponse>({
    path: "/v6/deployments",
    token: params.token,
    query,
  });

  const latestBuilding = (response.deployments ?? [])
    .filter((deployment) => {
      if (!getDeploymentUrl(deployment)) {
        return false;
      }

      const state = deployment.readyState ?? deployment.state ?? "";
      if (!BUILDING_STATES.has(state)) {
        return false;
      }

      return deployment.target !== "production";
    })
    .sort(
      (left, right) =>
        getDeploymentRecencyTimestamp(right) -
        getDeploymentRecencyTimestamp(left),
    )[0];

  return latestBuilding ? getDeploymentUrl(latestBuilding) : null;
}

/**
 * Returns the Vercel inspector URL (dashboard / build-logs page) for the
 * most recent failed preview deployment on the given branch, or `null` if
 * there is no such deployment.
 */
export async function findLatestFailedDeploymentInspectorUrlForBranch(params: {
  token: string;
  projectIdOrName: string;
  branch: string;
  teamId?: string | null;
}): Promise<string | null> {
  const branch = params.branch.trim();
  if (!branch) {
    return null;
  }

  const query = new URLSearchParams({
    projectId: params.projectIdOrName,
    branch,
    limit: "5",
  });
  if (params.teamId) {
    query.set("teamId", params.teamId);
  }

  const response = await fetchVercelJson<VercelDeploymentsResponse>({
    path: "/v6/deployments",
    token: params.token,
    query,
  });

  const latestError = (response.deployments ?? [])
    .filter((deployment) => {
      const state = deployment.readyState ?? deployment.state ?? "";
      return (
        ERROR_STATES.has(state) &&
        deployment.target !== "production" &&
        isNonEmptyString(deployment.inspectorUrl)
      );
    })
    .sort(
      (left, right) =>
        getDeploymentRecencyTimestamp(right) -
        getDeploymentRecencyTimestamp(left),
    )[0];

  return latestError?.inspectorUrl ?? null;
}
