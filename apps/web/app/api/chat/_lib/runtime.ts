import { createHash } from "node:crypto";
import { discoverSkills } from "@open-harness/agent";
import { connectSandbox } from "@open-harness/sandbox";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import type { SessionRecord } from "./chat-context";

type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;
type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;
type ActiveSandboxState = NonNullable<SessionRecord["sandboxState"]>;

const remoteAuthFingerprintBySessionId = new Map<string, string>();

function getRemoteAuthFingerprint(authUrl: string) {
  return createHash("sha256").update(authUrl).digest("hex");
}

async function resolveGitHubToken(
  userId: string,
  sessionRecord: SessionRecord,
): Promise<string | null> {
  if (sessionRecord.repoOwner) {
    try {
      const tokenResult = await getRepoToken(userId, sessionRecord.repoOwner);
      return tokenResult.token;
    } catch {
      return getUserGitHubToken();
    }
  }

  return getUserGitHubToken();
}

async function refreshGitRemoteAuth(
  sandbox: ConnectedSandbox,
  sessionId: string,
  sessionRecord: SessionRecord,
  githubToken: string | null,
): Promise<void> {
  if (githubToken && sessionRecord.repoOwner && sessionRecord.repoName) {
    const authUrl = `https://x-access-token:${githubToken}@github.com/${sessionRecord.repoOwner}/${sessionRecord.repoName}.git`;
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

async function loadSessionSkills(
  sessionId: string,
  sandboxState: ActiveSandboxState,
  sandbox: ConnectedSandbox,
): Promise<DiscoveredSkills> {
  const cachedSkills = await getCachedSkills(sessionId, sandboxState);
  if (cachedSkills !== null) {
    return cachedSkills;
  }

  // Discover project-level skills from the sandbox working directory.
  // TODO: Optimize if this becomes a bottleneck (~20ms no skills, ~130ms with 5 skills)
  const skillBaseFolders = [".claude", ".agents"];
  const skillDirs = skillBaseFolders.map(
    (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
  );

  const discoveredSkills = await discoverSkills(sandbox, skillDirs);
  await setCachedSkills(sessionId, sandboxState, discoveredSkills);
  return discoveredSkills;
}

export async function createChatRuntime(params: {
  userId: string;
  sessionId: string;
  sessionRecord: SessionRecord;
}): Promise<{
  sandbox: ConnectedSandbox;
  skills: DiscoveredSkills;
}> {
  const { userId, sessionId, sessionRecord } = params;

  const githubToken = await resolveGitHubToken(userId, sessionRecord);

  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    throw new Error("Sandbox state is required to create chat runtime");
  }

  const sandbox = await connectSandbox(sandboxState, {
    env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
    ports: DEFAULT_SANDBOX_PORTS,
  });

  await refreshGitRemoteAuth(sandbox, sessionId, sessionRecord, githubToken);

  const skills = await loadSessionSkills(sessionId, sandboxState, sandbox);

  return {
    sandbox,
    skills,
  };
}
