import {
  connectSandbox,
  type FileEntry,
  type SandboxState,
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
  sandboxType?: "hybrid" | "vercel" | "just-bash";
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
    sandboxType = "hybrid",
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
  // NEW SANDBOX: Create based on sandboxType
  // ============================================
  const startTime = Date.now();

  // Download and extract tarball if repo provided (needed for hybrid and just-bash)
  let files: Record<string, FileEntry> = {};
  if (repoUrl && (sandboxType === "hybrid" || sandboxType === "just-bash")) {
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
    files = toFileEntries(tarballResult.files);
  }

  const source = repoUrl
    ? {
        repo: repoUrl,
        branch: isNewBranch ? undefined : branch,
        token: githubToken,
      }
    : undefined;

  let sandbox;

  if (sandboxType === "just-bash") {
    // Local-only sandbox
    sandbox = await connectSandbox({
      state: {
        type: "just-bash",
        files,
        workingDirectory: WORKING_DIR,
        source,
      },
      options: {
        env: { GITHUB_TOKEN: githubToken },
      },
    });
  } else if (sandboxType === "vercel") {
    // Cloud-first sandbox
    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        source,
      },
      options: {
        env: { GITHUB_TOKEN: githubToken },
        gitUser,
      },
    });
  } else {
    // Default: hybrid sandbox (local first, then cloud)
    sandbox = await connectSandbox({
      state: {
        type: "hybrid",
        files,
        workingDirectory: WORKING_DIR,
        source,
      },
      options: {
        env: { GITHUB_TOKEN: githubToken },
        gitUser,
        scheduleBackgroundWork: (cb) => after(cb),
        hooks: taskId
          ? {
              onCloudSandboxReady: async (sandboxId) => {
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
            }
          : undefined,
      },
    });
  }

  if (taskId && sandbox.getState) {
    await updateTask(taskId, {
      sandboxState: sandbox.getState() as SandboxState,
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: sandboxType === "just-bash" ? null : DEFAULT_TIMEOUT,
    currentBranch: repoUrl ? branch : undefined,
    mode: sandboxType,
    timing: { readyMs },
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
