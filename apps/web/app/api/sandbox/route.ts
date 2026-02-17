import {
  connectSandbox,
  type FileEntry,
  type SandboxState,
} from "@open-harness/sandbox";
import { after } from "next/server";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { parseGitHubUrl } from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { downloadAndExtractTarball } from "@/lib/github/tarball";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
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

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let githubToken: string | null = null;

  if (repoUrl) {
    const parsedRepo = parseGitHubUrl(repoUrl);
    if (!parsedRepo) {
      return Response.json(
        { error: "Invalid GitHub repository URL" },
        { status: 400 },
      );
    }

    try {
      const tokenResult = await getRepoToken(session.user.id, parsedRepo.owner);
      githubToken = tokenResult.token;
    } catch {
      return Response.json(
        { error: "Connect GitHub to access repositories" },
        { status: 403 },
      );
    }
  } else {
    githubToken = await getUserGitHubToken();
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
      session.user.email ?? `${session.user.username}@users.noreply.vercel.app`,
  };

  const env: Record<string, string> = {};
  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
  }

  // ============================================
  // RECONNECT: Existing sandbox
  // ============================================
  if (providedSandboxId) {
    const sandbox = await connectSandbox({
      state: { type: "hybrid", sandboxId: providedSandboxId },
      options: { env },
    });

    if (sessionId && sandbox.getState) {
      const nextState = sandbox.getState() as SandboxState;
      await updateSession(sessionId, {
        sandboxState: nextState,
        lifecycleVersion: getNextLifecycleVersion(
          sessionRecord?.lifecycleVersion,
        ),
        ...buildActiveLifecycleUpdate(nextState),
      });
      kickSandboxLifecycleWorkflow({
        sessionId,
        reason: "sandbox-created",
      });
    }

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
        githubToken ?? undefined,
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
        token: githubToken ?? undefined,
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
      options: { env },
    });
  } else if (sandboxType === "vercel") {
    // Cloud-first sandbox
    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        source,
      },
      options: {
        env,
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
        env,
        gitUser,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        scheduleBackgroundWork: (cb) => after(cb),
        hooks: sessionId
          ? {
              onCloudSandboxReady: async (sandboxId) => {
                const currentSession = await getSessionById(sessionId);
                if (currentSession?.sandboxState?.type === "hybrid") {
                  const nextState: SandboxState = { type: "hybrid", sandboxId };
                  await updateSession(sessionId, {
                    sandboxState: nextState,
                    lifecycleVersion: getNextLifecycleVersion(
                      currentSession.lifecycleVersion,
                    ),
                    ...buildActiveLifecycleUpdate(nextState),
                  });
                  console.log(
                    `[Sandbox] Cloud sandbox ready for session ${sessionId}: ${sandboxId}`,
                  );

                  kickSandboxLifecycleWorkflow({
                    sessionId,
                    reason: "cloud-ready",
                  });
                }
              },
              onCloudSandboxFailed: async (error) => {
                await updateSession(sessionId, {
                  lifecycleState: "failed",
                  lifecycleError: error.message,
                });
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
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(sessionId, {
      sandboxState: nextState,
      lifecycleVersion: getNextLifecycleVersion(
        sessionRecord?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(nextState),
    });

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "sandbox-created",
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
    lifecycleState: sessionRecord.snapshotUrl ? "hibernated" : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  return Response.json({ success: true });
}
