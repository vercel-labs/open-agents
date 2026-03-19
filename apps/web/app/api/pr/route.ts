import { getSessionById, updateSession } from "@/lib/db/sessions";
import { createPullRequest, parseGitHubUrl } from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreatePRRequest {
  sessionId: string;
  repoUrl: string;
  branchName?: string;
  title: string;
  body?: string;
  baseBranch: string;
  headOwner?: string;
  isDraft?: boolean;
}

function buildGitHubCompareUrl(params: {
  owner: string;
  repo: string;
  baseBranch: string;
  headRef: string;
  title?: string;
  body?: string;
}): string {
  const { owner, repo, baseBranch, headRef, title, body } = params;
  const compareUrl = new URL(
    `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headRef)}`,
  );
  compareUrl.searchParams.set("expand", "1");

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    compareUrl.searchParams.set("title", trimmedTitle);
  }

  const trimmedBody = body?.trim();
  if (trimmedBody) {
    compareUrl.searchParams.set("body", trimmedBody);
  }

  return compareUrl.toString();
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse and validate request
  let body: CreatePRRequest;
  try {
    body = (await req.json()) as CreatePRRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    sessionId,
    repoUrl,
    branchName,
    title,
    body: prBody,
    baseBranch,
    headOwner,
    isDraft = false,
  } = body;

  if (!sessionId || !repoUrl || !title || !baseBranch) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (typeof isDraft !== "boolean") {
    return Response.json({ error: "Invalid draft flag" }, { status: 400 });
  }

  // Validate repoUrl format (GitHub URLs only)
  const githubUrlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
  if (!githubUrlPattern.test(repoUrl)) {
    return Response.json({ error: "Invalid repository URL" }, { status: 400 });
  }

  const parsedRepoUrl = parseGitHubUrl(repoUrl);
  if (!parsedRepoUrl) {
    return Response.json({ error: "Invalid repository URL" }, { status: 400 });
  }

  // Validate branch names to prevent injection
  const safeBranchPattern = /^[\w\-/.]+$/;
  if (!safeBranchPattern.test(baseBranch)) {
    return Response.json(
      { error: "Invalid base branch name" },
      { status: 400 },
    );
  }

  // 3. Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const resolvedBranch = sessionRecord.branch ?? branchName;

  if (!resolvedBranch) {
    return Response.json({ error: "Branch name is required" }, { status: 400 });
  }

  if (!safeBranchPattern.test(resolvedBranch)) {
    return Response.json({ error: "Invalid branch name" }, { status: 400 });
  }

  if (headOwner && !safeBranchPattern.test(headOwner)) {
    return Response.json({ error: "Invalid head owner" }, { status: 400 });
  }

  let tokenResult: Awaited<ReturnType<typeof getRepoToken>>;
  try {
    tokenResult = await getRepoToken(session.user.id, parsedRepoUrl.owner);
  } catch {
    return Response.json(
      { error: "No GitHub token available for this repository" },
      { status: 403 },
    );
  }

  const userToken = await getUserGitHubToken();
  const tokenCandidates: string[] = [];

  let headRef = resolvedBranch;
  const normalizedBaseOwner = parsedRepoUrl.owner.toLowerCase();
  const normalizedHeadOwner = headOwner?.trim().toLowerCase();

  if (normalizedHeadOwner && normalizedHeadOwner !== normalizedBaseOwner) {
    // Cross-fork PRs: prefer user token first since installation tokens are
    // scoped to specific repos and may not cover the fork owner.
    headRef = `${headOwner}:${resolvedBranch}`;
    if (userToken) {
      tokenCandidates.push(userToken);
    }
  }

  // Always try the installation token (or user token if no installation) first
  // for same-owner PRs, so the PR is created from the GitHub App installation.
  tokenCandidates.push(tokenResult.token);

  // Fall back to user token if the primary token fails (e.g. repo-scoped
  // installation tokens that don't cover this particular repo).
  if (tokenResult.type === "installation" && userToken) {
    tokenCandidates.push(userToken);
  }

  const dedupedTokenCandidates: string[] = [];
  for (const token of tokenCandidates) {
    if (!dedupedTokenCandidates.includes(token)) {
      dedupedTokenCandidates.push(token);
    }
  }

  // 4. Create PR using existing function
  let result = await createPullRequest({
    repoUrl,
    branchName: resolvedBranch,
    headRef,
    title,
    body: prBody || "",
    baseBranch,
    isDraft,
    token: dedupedTokenCandidates[0],
  });

  if (!result.success && dedupedTokenCandidates.length > 1) {
    result = await createPullRequest({
      repoUrl,
      branchName: resolvedBranch,
      headRef,
      title,
      body: prBody || "",
      baseBranch,
      isDraft,
      token: dedupedTokenCandidates[1],
    });
  }

  if (!result.success) {
    const error = result.error || "Failed to create pull request";

    if (error === "Permission denied") {
      const compareUrl = buildGitHubCompareUrl({
        owner: parsedRepoUrl.owner,
        repo: parsedRepoUrl.repo,
        baseBranch,
        headRef,
        title,
        body: prBody,
      });

      return Response.json({
        success: true,
        prUrl: compareUrl,
        requiresManualCreation: true,
      });
    }

    // Determine appropriate status code based on error type
    // Client errors (400): invalid input, PR already exists
    // Server errors (502): GitHub API failures, network issues
    const isClientError =
      error.includes("Invalid") ||
      error.includes("already exists") ||
      error.includes("not found") ||
      error.includes("not connected");

    return Response.json({ error }, { status: isClientError ? 400 : 502 });
  }

  // 5. Update session with PR info
  const updatedSession = await updateSession(sessionId, {
    prNumber: result.prNumber,
    prStatus: "open",
  });

  if (!updatedSession) {
    // PR was created but session update failed - log error but still return PR info
    console.error(`Failed to update session ${sessionId} with PR info`);
  }

  // 6. Return success
  return Response.json({
    success: true,
    prUrl: result.prUrl,
    prNumber: result.prNumber,
    prStatus: "open",
  });
}
