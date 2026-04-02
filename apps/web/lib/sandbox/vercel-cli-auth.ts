import "server-only";
import type { Sandbox } from "@open-harness/sandbox";
import {
  resolveSandboxHomeDirectory,
  shellEscape,
} from "@/lib/sandbox/home-directory";
import { getUserVercelAuthInfo } from "@/lib/vercel/token";

const FILE_CLEANUP_TIMEOUT_MS = 5_000;
const VERCEL_CLI_CONFIG_DIRECTORY = ".local/share/com.vercel.cli";

export interface VercelCliProjectLink {
  orgId: string;
  projectId: string;
  projectName?: string;
}

export interface VercelCliAuthConfig {
  token: string;
  expiresAt: number;
}

export interface VercelCliSandboxSetup {
  auth: VercelCliAuthConfig | null;
  projectLink: VercelCliProjectLink | null;
}

interface SessionVercelCliContext {
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamId: string | null;
}

async function removeFileIfPresent(
  sandbox: Sandbox,
  filePath: string,
): Promise<void> {
  const result = await sandbox.exec(
    `rm -f ${shellEscape(filePath)}`,
    sandbox.workingDirectory,
    FILE_CLEANUP_TIMEOUT_MS,
  );

  if (!result.success) {
    throw new Error(
      `Failed to remove ${filePath}: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

function buildProjectLink(params: {
  orgId: string | null;
  projectId: string | null;
  projectName: string | null;
}): VercelCliProjectLink | null {
  if (!params.orgId || !params.projectId) {
    return null;
  }

  return {
    orgId: params.orgId,
    projectId: params.projectId,
    ...(params.projectName ? { projectName: params.projectName } : {}),
  };
}

export async function getVercelCliSandboxSetup(params: {
  userId: string;
  sessionRecord: SessionVercelCliContext;
}): Promise<VercelCliSandboxSetup> {
  const authInfo = await getUserVercelAuthInfo(params.userId);
  const orgId =
    params.sessionRecord.vercelTeamId ?? authInfo?.externalId ?? null;

  return {
    auth: authInfo
      ? {
          token: authInfo.token,
          expiresAt: authInfo.expiresAt,
        }
      : null,
    projectLink: buildProjectLink({
      orgId,
      projectId: params.sessionRecord.vercelProjectId,
      projectName: params.sessionRecord.vercelProjectName,
    }),
  };
}

export async function syncVercelCliAuthToSandbox(params: {
  sandbox: Sandbox;
  setup: VercelCliSandboxSetup;
}): Promise<void> {
  const { sandbox, setup } = params;
  const homeDirectory = await resolveSandboxHomeDirectory(sandbox);
  const authConfigPath = `${homeDirectory}/${VERCEL_CLI_CONFIG_DIRECTORY}/auth.json`;
  const projectLinkPath = `${sandbox.workingDirectory}/.vercel/project.json`;

  if (setup.auth) {
    await sandbox.writeFile(
      authConfigPath,
      `${JSON.stringify(setup.auth, null, 2)}\n`,
      "utf-8",
    );
  } else {
    await removeFileIfPresent(sandbox, authConfigPath);
  }

  if (setup.projectLink) {
    await sandbox.writeFile(
      projectLinkPath,
      `${JSON.stringify(setup.projectLink, null, 2)}\n`,
      "utf-8",
    );
  } else {
    await removeFileIfPresent(sandbox, projectLinkPath);
  }
}
