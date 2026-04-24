interface GeneratePrRequest {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  createBranchOnly?: boolean;
  commitOnly?: boolean;
  skipPush?: boolean;
  commitTitle?: string;
  commitBody?: string;
}

export interface RepoBranchesResponse {
  branches: string[];
  defaultBranch: string;
}

export interface GitActionsResult {
  committed?: boolean;
  commitMessage?: string;
  commitSha?: string;
  pushed?: boolean;
}

export interface GeneratePrResult {
  title?: string;
  body?: string;
  branchName?: string;
  gitActions?: GitActionsResult;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseGitActions(value: unknown): GitActionsResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    committed: readBoolean(value.committed),
    commitMessage: readString(value.commitMessage),
    commitSha: readString(value.commitSha),
    pushed: readBoolean(value.pushed),
  };
}

function parseGeneratePrResult(value: unknown): GeneratePrResult {
  if (!isRecord(value)) {
    return {};
  }

  return {
    title: readString(value.title),
    body: readString(value.body),
    branchName: readString(value.branchName),
    gitActions: parseGitActions(value.gitActions),
    error: readString(value.error),
  };
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
  const defaultBranch = readString(data.defaultBranch) ?? "main";

  return {
    branches,
    defaultBranch,
  };
}

export async function requestGeneratePr(
  payload: GeneratePrRequest,
): Promise<GeneratePrResult> {
  const response = await fetch("/api/generate-pr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data: unknown = await response.json().catch(() => ({}));
  const parsedResult = parseGeneratePrResult(data);

  if (!response.ok) {
    throw new Error(parsedResult.error ?? "Failed to run git action");
  }

  return parsedResult;
}

export async function createSessionBranch(params: {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
}): Promise<{ branchName: string }> {
  const result = await requestGeneratePr({
    ...params,
    createBranchOnly: true,
  });

  const nextBranchName = result.branchName;
  if (!nextBranchName) {
    throw new Error("Failed to determine branch name");
  }

  return { branchName: nextBranchName };
}

export async function commitAndPushSessionChanges(params: {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  commitTitle?: string;
  commitBody?: string;
  skipPush?: boolean;
}): Promise<GeneratePrResult> {
  return requestGeneratePr({
    ...params,
    commitOnly: true,
  });
}

export async function discardSessionUncommittedChanges(params: {
  sessionId: string;
  filePath?: string;
  oldPath?: string;
}): Promise<void> {
  const response = await fetch(
    `/api/sessions/${params.sessionId}/discard-uncommitted`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(params.filePath ? { filePath: params.filePath } : {}),
        ...(params.oldPath ? { oldPath: params.oldPath } : {}),
      }),
    },
  );

  const data: unknown = await response.json().catch(() => ({}));
  const errorMessage = isRecord(data) ? readString(data.error) : undefined;

  if (!response.ok) {
    throw new Error(errorMessage ?? "Failed to discard uncommitted changes");
  }
}

export async function generatePullRequestContent(params: {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
}): Promise<GeneratePrResult> {
  return requestGeneratePr(params);
}
