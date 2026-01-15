import {
  connectVercelSandbox,
  createJustBashSandbox,
} from "@open-harness/sandbox";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const WORKING_DIR = "/vercel/sandbox";

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

  // Validate task ownership and sandbox association
  let task;
  if (taskId) {
    task = await getTaskById(taskId);
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.userId !== session.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    // Validate provided sandboxId matches task's sandbox (if any)
    if (providedSandboxId && task.sandboxId !== providedSandboxId) {
      return Response.json(
        { error: "Sandbox does not belong to this task" },
        { status: 403 },
      );
    }
  }

  // ============================================
  // HYBRID SANDBOX: Fast startup with JustBash
  // ============================================
  //
  // For new tasks with a repo, use hybrid approach:
  // 1. Create JustBash immediately (~100-500ms) - user can start chatting
  // 2. Start Vercel in background - auto-handoff when ready
  //
  // For reconnecting to existing sandbox or no repo, use Vercel directly.

  const useHybridApproach = repoUrl && taskId && !providedSandboxId;

  if (useHybridApproach) {
    const startTime = Date.now();

    // 1. Download tarball and create JustBash (fast path)
    let tarballResult;
    try {
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        githubToken,
        WORKING_DIR,
      );
    } catch {
      // If token fails (private repo issue), try without token for public repos
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        undefined,
        WORKING_DIR,
      );
    }

    // 2. Create and serialize JustBash sandbox
    const sandbox = await createJustBashSandbox({
      workingDirectory: WORKING_DIR,
      files: tarballResult.files,
      mode: "memory",
    });
    const snapshot = sandbox.serialize();
    await sandbox.stop();

    // 3. Persist JustBash state to task
    await updateTask(taskId, {
      justBashSnapshot: snapshot,
      sandboxMode: "justbash",
      pendingOperations: [],
      // Mark Vercel as starting (will be started in background)
      vercelStatus: "starting",
      vercelStartedAt: new Date(),
    });

    const justBashReadyMs = Date.now() - startTime;

    // 4. Start Vercel in background (fire-and-forget)
    // We don't await this - it runs in the background
    startVercelInBackground({
      taskId,
      repoUrl,
      branch,
      isNewBranch,
      githubToken,
      session,
    }).catch((error) => {
      console.error("[Sandbox] Background Vercel startup failed:", error);
    });

    // 5. Return immediately - user can start chatting with JustBash
    return Response.json({
      sandboxId: `justbash-${taskId}`, // Placeholder ID indicating JustBash mode
      createdAt: Date.now(),
      timeout: DEFAULT_TIMEOUT,
      currentBranch: branch,
      mode: "hybrid",
      justBashReady: true,
      vercelStatus: "starting",
      timing: {
        justBashReadyMs,
      },
    });
  }

  // ============================================
  // LEGACY PATH: Direct Vercel connection
  // ============================================
  // Used when:
  // - Reconnecting to existing sandbox (providedSandboxId)
  // - No repo URL provided
  // - No taskId provided

  let vercelSandbox;

  // If reconnecting to existing sandbox
  if (providedSandboxId) {
    vercelSandbox = await connectVercelSandbox({
      sandboxId: providedSandboxId,
      env: { GITHUB_TOKEN: githubToken },
    });
  } else {
    // Create new sandbox
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
        ...(isNewBranch ? { newBranch: branch } : { branch }),
      };
    }

    vercelSandbox = await connectVercelSandbox(sandboxOptions);
  }

  // Update task with sandbox metadata
  const sandboxCreatedAt = new Date();
  if (taskId) {
    await updateTask(taskId, {
      sandboxId: vercelSandbox.id,
      sandboxCreatedAt,
      sandboxTimeout: DEFAULT_TIMEOUT,
      sandboxMode: "vercel",
    });
  }

  return Response.json({
    sandboxId: vercelSandbox.id,
    createdAt: Date.now(),
    timeout: DEFAULT_TIMEOUT,
    currentBranch: vercelSandbox.currentBranch,
    mode: "vercel",
  });
}

/**
 * Start Vercel sandbox in background.
 * This function is fire-and-forget - errors are logged but not thrown.
 */
async function startVercelInBackground(options: {
  taskId: string;
  repoUrl: string;
  branch: string;
  isNewBranch: boolean;
  githubToken: string;
  session: {
    user: { name?: string | null; username: string; email?: string | null };
  };
}) {
  const { taskId, repoUrl, branch, isNewBranch, githubToken, session } =
    options;

  try {
    const sandbox = await connectVercelSandbox({
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
      source: {
        url: repoUrl,
        token: githubToken,
        ...(isNewBranch ? { newBranch: branch } : { branch }),
      },
    });

    // Update task with Vercel sandbox info
    await updateTask(taskId, {
      vercelStatus: "ready",
      sandboxId: sandbox.id,
      sandboxCreatedAt: new Date(),
      sandboxTimeout: DEFAULT_TIMEOUT,
    });

    console.log(
      `[Sandbox] Vercel ready in background for task ${taskId}: ${sandbox.id}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(taskId, {
      vercelStatus: "failed",
      vercelError: message,
    });
    console.error(
      `[Sandbox] Vercel background startup failed for task ${taskId}:`,
      message,
    );
  }
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

  // Clear sandbox metadata from task so future sandbox creation doesn't fail validation
  await updateTask(taskId, {
    sandboxId: null,
    sandboxCreatedAt: null,
    sandboxTimeout: null,
  });

  return Response.json({ success: true });
}
