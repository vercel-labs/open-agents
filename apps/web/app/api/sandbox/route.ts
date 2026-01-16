import {
  connectSandbox,
  HybridSandbox,
  VercelSandbox,
  type FileEntry,
} from "@open-harness/sandbox";
import { after } from "next/server";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const WORKING_DIR = "/vercel/sandbox";

/**
 * Convert simple file strings to FileEntry format.
 */
function toFileEntries(
  files: Record<string, string>,
): Record<string, FileEntry> {
  const entries: Record<string, FileEntry> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = { type: "file", content };
  }
  return entries;
}

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  taskId?: string;
  sandboxId?: string;
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

  // Validate task ownership
  let task;
  if (taskId) {
    task = await getTaskById(taskId);
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.userId !== session.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const gitUser = {
    name: session.user.name ?? session.user.username,
    email:
      session.user.email ?? `${session.user.username}@users.noreply.github.com`,
  };

  // ============================================
  // RECONNECT: Existing sandbox
  // ============================================
  if (providedSandboxId) {
    const sandbox = await connectSandbox({
      state: { type: "hybrid", sandboxId: providedSandboxId },
      options: { env: { GITHUB_TOKEN: githubToken } },
    });

    return Response.json({
      sandboxId: providedSandboxId,
      createdAt: Date.now(),
      timeout: DEFAULT_TIMEOUT,
      currentBranch: sandbox.currentBranch,
      mode: "hybrid",
    });
  }

  // ============================================
  // NEW SANDBOX: Hybrid approach
  // ============================================
  if (repoUrl && taskId) {
    const startTime = Date.now();

    // Client responsibility: Download and extract tarball
    let tarballResult;
    try {
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        githubToken,
        WORKING_DIR,
      );
    } catch {
      // Retry without token for public repos
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        undefined,
        WORKING_DIR,
      );
    }

    // Connect to hybrid sandbox with files
    const sandbox = await connectSandbox({
      state: {
        type: "hybrid",
        files: toFileEntries(tarballResult.files),
        workingDirectory: WORKING_DIR,
        source: {
          repo: repoUrl,
          branch: isNewBranch ? undefined : branch,
          token: githubToken,
        },
      },
      options: {
        env: { GITHUB_TOKEN: githubToken },
        gitUser,
        scheduleBackgroundWork: (cb) => after(cb),
        hooks: {
          onCloudSandboxReady: async (sandboxId) => {
            // Update task state when cloud sandbox is ready
            const currentTask = await getTaskById(taskId);
            if (currentTask?.sandboxState?.type === "hybrid") {
              await updateTask(taskId, {
                sandboxState: { type: "hybrid", sandboxId },
              });
              console.log(
                `[Sandbox] Cloud sandbox ready for task ${taskId}: ${sandboxId}`,
              );
            }
          },
          onCloudSandboxFailed: async (error) => {
            console.error(
              `[Sandbox] Cloud sandbox failed for task ${taskId}:`,
              error.message,
            );
          },
        },
      },
    });

    // Persist initial state (JustBash files + pending ops)
    if (sandbox instanceof HybridSandbox) {
      await updateTask(taskId, { sandboxState: sandbox.getState() });
    }

    const readyMs = Date.now() - startTime;

    return Response.json({
      createdAt: Date.now(),
      timeout: DEFAULT_TIMEOUT,
      currentBranch: branch,
      mode: "hybrid",
      timing: { readyMs },
    });
  }

  // ============================================
  // FALLBACK: Direct cloud sandbox (no repo)
  // ============================================
  const sandbox = await connectSandbox({
    state: { type: "vercel", source: undefined },
    options: {
      env: { GITHUB_TOKEN: githubToken },
      gitUser,
    },
  });

  if (taskId && sandbox instanceof VercelSandbox) {
    await updateTask(taskId, { sandboxState: sandbox.getState() });
  }

  const sandboxId = sandbox instanceof VercelSandbox ? sandbox.id : undefined;

  return Response.json({
    sandboxId,
    createdAt: Date.now(),
    timeout: DEFAULT_TIMEOUT,
    mode: "vercel",
  });
}

export async function DELETE(req: Request) {
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
    !("taskId" in body) ||
    typeof (body as Record<string, unknown>).taskId !== "string"
  ) {
    return Response.json({ error: "Missing taskId" }, { status: 400 });
  }

  const { taskId } = body as { taskId: string };

  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!task.sandboxState) {
    return Response.json({ error: "No sandbox to stop" }, { status: 400 });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox(task.sandboxState);
  await sandbox.stop();

  await updateTask(taskId, { sandboxState: null });

  return Response.json({ success: true });
}
