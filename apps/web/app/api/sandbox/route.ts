import { connectVercelSandbox } from "@open-harness/sandbox";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  taskId?: string;
  sandboxId?: string; // Existing sandbox ID if any
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    repoUrl,
    branch = "main",
    isNewBranch = false,
    taskId,
    sandboxId: providedSandboxId,
  } = body;

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

  let taskSandboxId = providedSandboxId;

  if (taskId) {
    const task = await getTaskById(taskId);
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.userId !== session.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (task.sandboxId) {
      if (providedSandboxId && task.sandboxId !== providedSandboxId) {
        return Response.json(
          { error: "Sandbox does not belong to this task" },
          { status: 403 },
        );
      }
      taskSandboxId = task.sandboxId;
    } else if (providedSandboxId) {
      return Response.json(
        { error: "Sandbox does not belong to this task" },
        { status: 403 },
      );
    }
  }

  // Determine if we should create a new branch
  // Frontend is responsible for deciding when to pass isNewBranch: true based on:
  // - First sandbox creation for a new branch task
  // - Snapshot restore when branch doesn't exist on origin (no PR created yet)
  // - Expired sandbox recreation when branch doesn't exist on origin
  const shouldCreateNewBranch = isNewBranch;

  // Build sandbox options - source is only included when repoUrl is provided
  const sandboxOptions: Parameters<typeof connectVercelSandbox>[0] = {
    timeout: DEFAULT_TIMEOUT,
    gitUser: {
      name: session.user.name ?? session.user.username,
      email:
        session.user.email ??
        `${session.user.username}@users.noreply.github.com`,
    },
    env: {
      GITHUB_TOKEN: githubToken,
    },
  };

  // Only add source when we have a repo to clone
  if (repoUrl) {
    sandboxOptions.source = {
      url: repoUrl,
      token: githubToken,
      // If creating new branch: don't specify branch (clone default), use newBranch
      // Otherwise: clone the specified branch
      ...(shouldCreateNewBranch ? { newBranch: branch } : { branch }),
    };
  }

  const sandbox = await connectVercelSandbox(sandboxOptions);

  // Update task with sandboxId if this is a new sandbox
  // This handles both first-time creation and sandbox recreation after expiry/restore
  if (taskId && sandbox.id !== taskSandboxId) {
    await updateTask(taskId, { sandboxId: sandbox.id });
  }

  return Response.json({
    sandboxId: sandbox.id,
    createdAt: Date.now(),
    timeout: DEFAULT_TIMEOUT,
    currentBranch: sandbox.currentBranch,
  });
}

export async function DELETE(req: Request) {
  // Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

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
    typeof (body as Record<string, unknown>).sandboxId !== "string" ||
    !("taskId" in body) ||
    typeof (body as Record<string, unknown>).taskId !== "string"
  ) {
    return Response.json(
      { error: "Missing sandboxId or taskId" },
      { status: 400 },
    );
  }

  const { sandboxId, taskId } = body as { sandboxId: string; taskId: string };

  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (task.sandboxId !== sandboxId) {
    return Response.json(
      { error: "Sandbox does not belong to this task" },
      { status: 403 },
    );
  }

  const sandbox = await connectVercelSandbox({ sandboxId });
  await sandbox.stop();

  // Clear sandboxId from task so future sandbox creation doesn't fail validation
  await updateTask(taskId, { sandboxId: null });

  return Response.json({ success: true });
}
