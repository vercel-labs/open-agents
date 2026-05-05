import { connectSandbox, type SandboxState } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { checkBotProtection } from "@/lib/botid";
import { getGitHubUserProfile } from "@/lib/github/users";
import { updateSession } from "@/lib/db/sessions";
import { parseGitHubHttpsUrl } from "@/lib/github/urls";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import {
  mintInstallationToken,
  revokeInstallationToken,
  type ScopedInstallationToken,
} from "@/lib/github/app";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import {
  canOperateOnSandbox,
  clearSandboxState,
  getSessionSandboxName,
  hasResumableSandboxState,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
// import { buildDevelopmentDotenvFromVercelProject } from "@/lib/vercel/projects";
// import { getUserVercelToken } from "@/lib/vercel/token";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  sessionId?: string;
  sandboxType?: "vercel";
}

// async function syncVercelProjectEnvVarsToSandbox(params: {
//   userId: string;
//   sessionRecord: SessionRecord;
//   sandbox: Awaited<ReturnType<typeof connectSandbox>>;
// }): Promise<void> {
//   if (!params.sessionRecord.vercelProjectId) {
//     return;
//   }
//
//   const token = await getUserVercelToken(params.userId);
//   if (!token) {
//     return;
//   }
//
//   const dotenvContent = await buildDevelopmentDotenvFromVercelProject({
//     token,
//     projectIdOrName: params.sessionRecord.vercelProjectId,
//     teamId: params.sessionRecord.vercelTeamId,
//   });
//   if (!dotenvContent) {
//     return;
//   }
//
//   await params.sandbox.writeFile(
//     `${params.sandbox.workingDirectory}/.env.local`,
//     dotenvContent,
//     "utf-8",
//   );
// }

async function installSessionGlobalSkills(params: {
  sessionRecord: SessionRecord;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<void> {
  const globalSkillRefs = params.sessionRecord.globalSkillRefs ?? [];
  if (globalSkillRefs.length === 0) {
    return;
  }

  await installGlobalSkills({
    sandbox: params.sandbox,
    globalSkillRefs,
  });
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  const { repoUrl, branch = "main", isNewBranch = false, sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["sandbox-create", session.user.id]),
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  // Validate session ownership before minting any short-lived setup tokens.
  let sessionRecord: SessionRecord | undefined;
  const sessionContext = await requireOwnedSession({
    userId: session.user.id,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  sessionRecord = sessionContext.sessionRecord;

  const sandboxName = getSessionSandboxName(sessionId);

  const source = repoUrl
    ? {
        repo: repoUrl,
        branch: isNewBranch ? undefined : branch,
        newBranch: isNewBranch ? branch : undefined,
      }
    : undefined;

  // verify repo access (user permissions ∩ installation scope) and get
  // a repo-scoped read token for clone/setup when a repo is provided
  let setupToken: ScopedInstallationToken | undefined;

  if (repoUrl) {
    const parsedRepo = parseGitHubHttpsUrl(repoUrl);
    if (!parsedRepo) {
      return Response.json(
        { error: "Invalid GitHub repository URL" },
        { status: 400 },
      );
    }

    const access = await verifyRepoAccess({
      userId: session.user.id,
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
    });

    if (!access.ok) {
      return Response.json(
        { error: getRepoAccessErrorMessage(access.reason) },
        { status: 403 },
      );
    }

    setupToken = await mintInstallationToken({
      installationId: access.installationId,
      repositoryIds: [access.repositoryId],
      permissions: { contents: "read" },
    });
  }

  // ============================================
  // CREATE OR RESUME: Create a named persistent sandbox for this session.
  // ============================================
  const startTime = Date.now();

  let sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  try {
    const ghProfile = await getGitHubUserProfile(session.user.id);
    const githubNoreplyEmail =
      ghProfile?.externalUserId && ghProfile.username
        ? `${ghProfile.externalUserId}+${ghProfile.username}@users.noreply.github.com`
        : undefined;

    const gitUser = {
      name: session.user.name ?? ghProfile?.username ?? session.user.username,
      email:
        githubNoreplyEmail ??
        session.user.email ??
        `${session.user.username}@users.noreply.github.com`,
    };

    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        ...(sandboxName ? { sandboxName } : {}),
        source,
      },
      options: {
        githubToken: setupToken?.token,
        gitUser,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        ports: DEFAULT_SANDBOX_PORTS,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: !!sandboxName,
        resume: !!sandboxName,
        createIfMissing: !!sandboxName,
      },
    });
  } finally {
    if (setupToken) {
      await revokeInstallationToken(setupToken.token);
    }
  }

  if (sessionId && sandbox.getState) {
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(sessionId, {
      sandboxState: nextState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(
        sessionRecord?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(nextState),
    });

    if (sessionRecord) {
      // TODO: Re-enable this once we have a solid exfiltration defense strategy.
      // try {
      //   await syncVercelProjectEnvVarsToSandbox({
      //     userId: session.user.id,
      //     sessionRecord,
      //     sandbox,
      //   });
      // } catch (error) {
      //   console.error(
      //     `Failed to sync Vercel env vars for session ${sessionRecord.id}:`,
      //     error,
      //   );
      // }

      try {
        await installSessionGlobalSkills({
          sessionRecord,
          sandbox,
        });
      } catch (error) {
        console.error(
          `Failed to install global skills for session ${sessionRecord.id}:`,
          error,
        );
      }
    }

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "sandbox-created",
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    currentBranch: repoUrl ? branch : undefined,
    mode: "vercel",
    timing: { readyMs },
  });
}

export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["sandbox-delete", authResult.userId]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
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

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  // If there's no sandbox to stop, return success (idempotent)
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ success: true, alreadyStopped: true });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  await sandbox.stop();

  const clearedState = clearSandboxState(sessionRecord.sandboxState);
  await updateSession(sessionId, {
    sandboxState: clearedState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleState:
      hasResumableSandboxState(clearedState) || !!sessionRecord.snapshotUrl
        ? "hibernated"
        : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  return Response.json({ success: true });
}
