import { getServerSession } from "@/lib/session/get-server-session";
import {
  getUserPreferences,
  type DiffMode,
  updateUserPreferences,
} from "@/lib/db/user-preferences";
import { sanitizeUserPreferencesForSession } from "@/lib/model-access";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import {
  globalSkillRefsSchema,
  type GlobalSkillRef,
} from "@/lib/skills/global-skill-refs";

interface UpdatePreferencesRequest {
  defaultModelId?: string;
  defaultSubagentModelId?: string | null;
  defaultSandboxType?: SandboxType;
  defaultDiffMode?: DiffMode;
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  alertsEnabled?: boolean;
  alertSoundEnabled?: boolean;
  publicUsageEnabled?: boolean;
  globalSkillRefs?: GlobalSkillRef[];
  enabledModelIds?: string[];
}

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const preferences = sanitizeUserPreferencesForSession(
    await getUserPreferences(session.user.id),
    session,
    req.url,
  );
  return Response.json({ preferences });
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: UpdatePreferencesRequest;
  try {
    body = (await req.json()) as UpdatePreferencesRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.defaultSandboxType !== undefined) {
    const validTypes = ["vercel"];
    if (
      typeof body.defaultSandboxType !== "string" ||
      !validTypes.includes(body.defaultSandboxType)
    ) {
      return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
    }
  }

  if (body.defaultDiffMode !== undefined) {
    const validDiffModes = ["unified", "split"];
    if (
      typeof body.defaultDiffMode !== "string" ||
      !validDiffModes.includes(body.defaultDiffMode)
    ) {
      return Response.json({ error: "Invalid diff mode" }, { status: 400 });
    }
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value" },
      { status: 400 },
    );
  }

  if (
    body.autoCreatePr !== undefined &&
    typeof body.autoCreatePr !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCreatePr value" },
      { status: 400 },
    );
  }

  if (
    body.alertsEnabled !== undefined &&
    typeof body.alertsEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid alertsEnabled value" },
      { status: 400 },
    );
  }

  if (
    body.alertSoundEnabled !== undefined &&
    typeof body.alertSoundEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid alertSoundEnabled value" },
      { status: 400 },
    );
  }

  if (
    body.publicUsageEnabled !== undefined &&
    typeof body.publicUsageEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid publicUsageEnabled value" },
      { status: 400 },
    );
  }

  if (body.globalSkillRefs !== undefined) {
    const parsedGlobalSkillRefs = globalSkillRefsSchema.safeParse(
      body.globalSkillRefs,
    );
    if (!parsedGlobalSkillRefs.success) {
      return Response.json(
        { error: "Invalid globalSkillRefs value" },
        { status: 400 },
      );
    }

    body.globalSkillRefs = parsedGlobalSkillRefs.data;
  }

  if (body.enabledModelIds !== undefined) {
    if (
      !Array.isArray(body.enabledModelIds) ||
      !body.enabledModelIds.every((id) => typeof id === "string")
    ) {
      return Response.json(
        { error: "Invalid enabledModelIds value" },
        { status: 400 },
      );
    }
  }

  try {
    const preferences = sanitizeUserPreferencesForSession(
      await updateUserPreferences(session.user.id, body),
      session,
      req.url,
    );
    return Response.json({ preferences });
  } catch (error) {
    console.error("Failed to update preferences:", error);
    return Response.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}
