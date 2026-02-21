import { discoverSkills } from "@open-harness/agent";
import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type SkillSuggestion = {
  name: string;
  description: string;
};

export type SkillsResponse = {
  skills: SkillSuggestion[];
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

const SKILLS_CACHE_TTL_MS = 60_000;

const discoveredSkillsCache = new Map<
  string,
  { skills: DiscoveredSkills; expiresAt: number }
>();

const getSkillCacheKey = (sessionId: string, workingDirectory: string) =>
  `${sessionId}:${workingDirectory}`;

const pruneExpiredSkillCache = (now: number) => {
  for (const [key, entry] of discoveredSkillsCache) {
    if (entry.expiresAt <= now) {
      discoveredSkillsCache.delete(key);
    }
  }
};

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasRuntimeSandboxState(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const skillBaseFolders = [".claude", ".agents"];
    const skillDirs = skillBaseFolders.map(
      (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
    );

    const now = Date.now();
    pruneExpiredSkillCache(now);
    const skillCacheKey = getSkillCacheKey(sessionId, sandbox.workingDirectory);
    const cachedSkills = discoveredSkillsCache.get(skillCacheKey);

    let skills: DiscoveredSkills;
    if (cachedSkills && cachedSkills.expiresAt > now) {
      skills = cachedSkills.skills;
    } else {
      skills = await discoverSkills(sandbox, skillDirs);
      discoveredSkillsCache.set(skillCacheKey, {
        skills,
        expiresAt: now + SKILLS_CACHE_TTL_MS,
      });
    }

    // Return only user-invocable skills with minimal metadata
    const suggestions: SkillSuggestion[] = skills
      .filter((skill) => skill.options.userInvocable !== false)
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
      }));

    const response: SkillsResponse = { skills: suggestions };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearSandboxState(sessionRecord.sandboxState),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        { error: "Sandbox is unavailable. Please resume sandbox." },
        { status: 409 },
      );
    }
    console.error("Failed to discover skills:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
