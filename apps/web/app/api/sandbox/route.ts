import {
  connectSandbox,
  type FileEntry,
  type SandboxState,
} from "@open-harness/sandbox";
import { after } from "next/server";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { downloadAndExtractTarball } from "@/lib/github/tarball";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";
import { canOperateOnSandbox, clearSandboxState } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

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
  sessionId?: string;
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
    sessionId,
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

  // Validate session ownership
  let sessionRecord;
  if (sessionId) {
    sessionRecord = await getSessionById(sessionId);
    if (!sessionRecord) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    if (sessionRecord.userId !== session.user.id) {
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
      timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
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
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
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
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        scheduleBackgroundWork: (cb) => after(cb),
        hooks: sessionId
          ? {
              onCloudSandboxReady: async (sandboxId) => {
                const currentSession = await getSessionById(sessionId);
                if (currentSession?.sandboxState?.type === "hybrid") {
                  await updateSession(sessionId, {
                    sandboxState: { type: "hybrid", sandboxId },
                  });
                  console.log(
                    `[Sandbox] Cloud sandbox ready for session ${sessionId}: ${sandboxId}`,
                  );
                }
              },
              onCloudSandboxFailed: async (error) => {
                console.error(
                  `[Sandbox] Cloud sandbox failed for session ${sessionId}:`,
                  error.message,
                );
              },
            }
          : undefined,
      },
    });
  }

  if (sessionId && sandbox.getState) {
    await updateSession(sessionId, {
      sandboxState: sandbox.getState() as SandboxState,
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: sandboxType === "just-bash" ? null : DEFAULT_SANDBOX_TIMEOUT_MS,
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
    !("sessionId" in body) ||
    typeof (body as Record<string, unknown>).sessionId !== "string"
  ) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const { sessionId } = body as { sessionId: string };

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // If there's no sandbox to stop, return success (idempotent)
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ success: true, alreadyStopped: true });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  await sandbox.stop();

  await updateSession(sessionId, {
    sandboxState: clearSandboxState(sessionRecord.sandboxState),
  });

  return Response.json({ success: true });
}
