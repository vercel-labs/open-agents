import { connectVercelSandbox } from "@open-harness/sandbox";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

interface CreateSandboxRequest {
  repoUrl: string;
  branch?: string;
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repoUrl, branch = "main" } = body;

  if (!repoUrl) {
    return Response.json({ error: "repoUrl is required" }, { status: 400 });
  }

  // Get user's GitHub token
  const githubToken = await getUserGitHubToken();
  if (!githubToken) {
    return Response.json({ error: "GitHub not connected" }, { status: 401 });
  }

  // Get session for git user info
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sandbox = await connectVercelSandbox({
    timeout: DEFAULT_TIMEOUT,
    source: {
      url: repoUrl,
      branch,
      token: githubToken,
    },
    gitUser: {
      name: session.user.name ?? session.user.username,
      email:
        session.user.email ??
        `${session.user.username}@users.noreply.github.com`,
    },
    env: {
      GITHUB_TOKEN: githubToken,
    },
  });

  return Response.json({
    sandboxId: sandbox.id,
    createdAt: Date.now(),
    timeout: DEFAULT_TIMEOUT,
    currentBranch: sandbox.currentBranch,
  });
}

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("sandboxId" in body) ||
    typeof (body as Record<string, unknown>).sandboxId !== "string"
  ) {
    return Response.json({ error: "Missing sandboxId" }, { status: 400 });
  }

  const { sandboxId } = body as { sandboxId: string };

  const sandbox = await connectVercelSandbox({ sandboxId });
  await sandbox.stop();

  return Response.json({ success: true });
}
