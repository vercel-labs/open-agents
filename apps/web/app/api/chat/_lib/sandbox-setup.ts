import { createHash } from "node:crypto";
import { discoverSkills } from "@open-harness/agent";
import { connectSandbox } from "@open-harness/sandbox";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import type { ActiveChatSessionRecord } from "./request-context";

export type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

const remoteAuthFingerprintBySessionId = new Map<string, string>();

const getRemoteAuthFingerprint = (authUrl: string) =>
  createHash("sha256").update(authUrl).digest("hex");

async function resolveGitHubToken(
  userId: string,
  repoOwner: string | null,
): Promise<string | null> {
  if (repoOwner) {
    try {
      const tokenResult = await getRepoToken(userId, repoOwner);
      return tokenResult.token;
    } catch {
      return getUserGitHubToken();
    }
  }

  return getUserGitHubToken();
}

async function refreshSandboxGitRemoteAuth(params: {
  sessionId: string;
  repoOwner: string | null;
  repoName: string | null;
  githubToken: string | null;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<void> {
  const { sessionId, repoOwner, repoName, githubToken, sandbox } = params;

  if (githubToken && repoOwner && repoName) {
    const authUrl = `https://x-access-token:${githubToken}@github.com/${repoOwner}/${repoName}.git`;
    const authFingerprint = getRemoteAuthFingerprint(authUrl);
    const previousAuthFingerprint =
      remoteAuthFingerprintBySessionId.get(sessionId);

    if (previousAuthFingerprint !== authFingerprint) {
      const remoteResult = await sandbox.exec(
        `git remote set-url origin "${authUrl}"`,
        sandbox.workingDirectory,
        5000,
      );

      if (!remoteResult.success) {
        console.warn(
          `Failed to refresh git remote auth for session ${sessionId}: ${remoteResult.stderr ?? remoteResult.stdout}`,
        );
      } else {
        remoteAuthFingerprintBySessionId.set(sessionId, authFingerprint);
      }
    }

    return;
  }

  remoteAuthFingerprintBySessionId.delete(sessionId);
}

async function loadSandboxSkills(params: {
  sessionId: string;
  sessionRecord: ActiveChatSessionRecord;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<DiscoveredSkills> {
  const { sessionId, sessionRecord, sandbox } = params;

  const cachedSkills = await getCachedSkills(
    sessionId,
    sessionRecord.sandboxState,
  );
  if (cachedSkills !== null) {
    return cachedSkills;
  }

  const skillBaseFolders = [".claude", ".agents"];
  const skillDirs = skillBaseFolders.map(
    (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
  );

  const skills = await discoverSkills(sandbox, skillDirs);
  await setCachedSkills(sessionId, sessionRecord.sandboxState, skills);
  return skills;
}

export async function setupChatSandbox(params: {
  sessionId: string;
  userId: string;
  sessionRecord: ActiveChatSessionRecord;
}): Promise<{
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  skills: DiscoveredSkills;
}> {
  const { sessionId, userId, sessionRecord } = params;

  const githubToken = await resolveGitHubToken(userId, sessionRecord.repoOwner);

  const sandbox = await connectSandbox(sessionRecord.sandboxState, {
    env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
    ports: DEFAULT_SANDBOX_PORTS,
  });

  await refreshSandboxGitRemoteAuth({
    sessionId,
    repoOwner: sessionRecord.repoOwner,
    repoName: sessionRecord.repoName,
    githubToken,
    sandbox,
  });

  const skills = await loadSandboxSkills({
    sessionId,
    sessionRecord,
    sandbox,
  });

  return {
    sandbox,
    skills,
  };
}
