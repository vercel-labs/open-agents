import { createPullRequest } from "@/lib/github/client";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreatePRRequest {
  sessionId: string;
  repoUrl: string;
  branchName?: string;
  title: string;
  body?: string;
  baseBranch: string;
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
  } = body;

  if (!sessionId || !repoUrl || !title || !baseBranch) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Validate repoUrl format (GitHub URLs only)
  const githubUrlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
  if (!githubUrlPattern.test(repoUrl)) {
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

  // 4. Create PR using existing function
  const result = await createPullRequest({
    repoUrl,
    branchName: resolvedBranch,
    title,
    body: prBody || "",
    baseBranch,
  });

  if (!result.success) {
    const error = result.error || "Failed to create pull request";

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
  });
}
