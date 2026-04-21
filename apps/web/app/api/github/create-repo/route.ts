import { connectSandbox } from "@open-agents/sandbox";
import { runCreateRepoWorkflow } from "@/app/api/github/create-repo/_lib/create-repo-workflow";
import { getGitHubUserProfile, getUserGitHubToken } from "@/lib/github/token";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// Allow up to 2 minutes for git operations
export const maxDuration = 120;

interface CreateRepoRequest {
  sessionId: string;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  sessionTitle: string;
  /** The account login to create the repo under (org name or username) */
  owner?: string;
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse request
  let body: CreateRepoRequest;
  try {
    body = (await req.json()) as CreateRepoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, repoName, description, isPrivate, sessionTitle, owner } =
    body;

  if (!sessionId) {
    return Response.json({ error: "Session ID is required" }, { status: 400 });
  }
  if (!repoName) {
    return Response.json(
      { error: "Repository name is required" },
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

  // Session should not already have a repo
  if (sessionRecord.cloneUrl) {
    return Response.json(
      { error: "Session already has a repository" },
      { status: 400 },
    );
  }

  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  // 4. Resolve GitHub OAuth token for repo creation
  const ghProfile = await getGitHubUserProfile(session.user.id);
  const repoToken = await getUserGitHubToken(session.user.id);

  if (!repoToken) {
    return Response.json({ error: "GitHub not connected" }, { status: 401 });
  }

  const githubUsername = ghProfile?.username?.trim();
  let accountType: "User" | "Organization" | undefined;

  if (owner) {
    accountType =
      githubUsername && owner.toLowerCase() === githubUsername.toLowerCase()
        ? "User"
        : "Organization";
  }

  // 5. Connect to sandbox
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  const workflowResult = await runCreateRepoWorkflow({
    sandbox,
    cwd,
    repoName,
    description,
    isPrivate,
    sessionTitle,
    owner,
    accountType,
    repoToken,
    sessionUser: {
      id: session.user.id,
      username: session.user.username,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    },
  });
  if (!workflowResult.ok) {
    return workflowResult.response;
  }

  // 16. Update session with new repo info
  await updateSession(sessionId, {
    repoOwner: workflowResult.owner,
    repoName: workflowResult.repoName,
    cloneUrl: `https://github.com/${workflowResult.owner}/${workflowResult.repoName}`,
    branch: workflowResult.branch,
    isNewBranch: false,
  });

  // 17. Return success response
  return Response.json({
    success: true,
    repoUrl: workflowResult.repoUrl,
    cloneUrl: workflowResult.cloneUrl,
    owner: workflowResult.owner,
    repoName: workflowResult.repoName,
    branch: workflowResult.branch,
  });
}
