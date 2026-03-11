import { discoverSkills } from "@open-harness/agent";
import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
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

function toSkillSuggestions(
  skills: Awaited<ReturnType<typeof discoverSkills>>,
): SkillSuggestion[] {
  return skills
    .filter((skill) => skill.options.userInvocable !== false)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
}

export async function GET(req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  if (!refresh) {
    const cachedSkills = await getCachedSkills(sessionId, sandboxState);
    if (cachedSkills !== null) {
      return Response.json({ skills: toSkillSuggestions(cachedSkills) });
    }
  }

  if (!hasRuntimeSandboxState(sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const skillBaseFolders = [".claude", ".agents"];
    const skillDirs = skillBaseFolders.map(
      (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
    );

    const skills = await discoverSkills(sandbox, skillDirs);
    await setCachedSkills(sessionId, sandboxState, skills);

    const response: SkillsResponse = { skills: toSkillSuggestions(skills) };
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
