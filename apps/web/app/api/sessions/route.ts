import { nanoid } from "nanoid";
import {
  createSessionWithInitialChat,
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
  getUsedSessionTitles,
} from "@/lib/db/sessions";
import {
  getVercelProjectLinkByRepo,
  upsertVercelProjectLink,
} from "@/lib/db/vercel-project-links";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { sanitizeUserPreferencesForSession } from "@/lib/model-access";
import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
} from "@/lib/github/urls";
import { getRandomCityName } from "@/lib/random-city";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  MANAGED_TEMPLATE_ACCESS_DENIED_ERROR,
  shouldRedirectManagedTemplateUser,
} from "@/lib/managed-template-access";
import {
  isVercelInvalidTokenError,
  listMatchingVercelProjects,
} from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";
import {
  vercelProjectSelectionSchema,
  type VercelProjectSelection,
} from "@/lib/vercel/types";

interface CreateSessionRequest {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch?: boolean;
  sandboxType?: "vercel";
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  vercelProject?: VercelProjectSelection | null;
}

function generateBranchName(username: string, name?: string | null): string {
  let initials = "nb";
  if (name) {
    initials =
      name
        .split(" ")
        .map((n) => n[0]?.toLowerCase() ?? "")
        .join("")
        .slice(0, 2) || "nb";
  } else if (username) {
    initials = username.slice(0, 2).toLowerCase();
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
}

async function resolveSessionTitle(
  input: CreateSessionRequest,
  userId: string,
): Promise<string> {
  if (input.title && input.title.trim()) {
    return input.title.trim();
  }
  const usedNames = await getUsedSessionTitles(userId);
  return getRandomCityName(usedNames);
}

const DEFAULT_ARCHIVED_SESSIONS_LIMIT = 50;
const MAX_ARCHIVED_SESSIONS_LIMIT = 100;

type SessionsStatusFilter = "all" | "active" | "archived";

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  return Number(value);
}

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get("status");
  if (
    rawStatus !== null &&
    rawStatus !== "all" &&
    rawStatus !== "active" &&
    rawStatus !== "archived"
  ) {
    return Response.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const statusParam: SessionsStatusFilter = rawStatus ?? "all";

  if (statusParam === "archived") {
    const rawLimit = parseNonNegativeInteger(searchParams.get("limit"));
    const rawOffset = parseNonNegativeInteger(searchParams.get("offset"));

    if (searchParams.get("limit") !== null && rawLimit === null) {
      return Response.json(
        { error: "Invalid archived limit" },
        { status: 400 },
      );
    }

    if (searchParams.get("offset") !== null && rawOffset === null) {
      return Response.json(
        { error: "Invalid archived offset" },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Math.max(rawLimit ?? DEFAULT_ARCHIVED_SESSIONS_LIMIT, 1),
      MAX_ARCHIVED_SESSIONS_LIMIT,
    );
    const offset = rawOffset ?? 0;

    const [sessions, archivedCount] = await Promise.all([
      getSessionsWithUnreadByUserId(session.user.id, {
        status: "archived",
        limit,
        offset,
      }),
      getArchivedSessionCountByUserId(session.user.id),
    ]);

    return Response.json({
      sessions,
      archivedCount,
      pagination: {
        limit,
        offset,
        hasMore: offset + sessions.length < archivedCount,
        nextOffset: offset + sessions.length,
      },
    });
  }

  if (statusParam === "active") {
    const [sessions, archivedCount] = await Promise.all([
      getSessionsWithUnreadByUserId(session.user.id, {
        status: "active",
      }),
      getArchivedSessionCountByUserId(session.user.id),
    ]);

    return Response.json({ sessions, archivedCount });
  }

  const sessions = await getSessionsWithUnreadByUserId(session.user.id);
  return Response.json({ sessions });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (shouldRedirectManagedTemplateUser(session, req.url)) {
    return Response.json(
      { error: MANAGED_TEMPLATE_ACCESS_DENIED_ERROR },
      { status: 403 },
    );
  }

  let body: CreateSessionRequest;
  try {
    body = (await req.json()) as CreateSessionRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
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
    body.repoOwner !== undefined &&
    (typeof body.repoOwner !== "string" ||
      !isValidGitHubRepoOwner(body.repoOwner))
  ) {
    return Response.json(
      { error: "Invalid repository owner" },
      { status: 400 },
    );
  }

  if (
    body.repoName !== undefined &&
    (typeof body.repoName !== "string" || !isValidGitHubRepoName(body.repoName))
  ) {
    return Response.json({ error: "Invalid repository name" }, { status: 400 });
  }

  let explicitVercelProject: VercelProjectSelection | null | undefined;
  if (body.vercelProject === null) {
    explicitVercelProject = null;
  } else if (body.vercelProject !== undefined) {
    const parsedProject = vercelProjectSelectionSchema.safeParse(
      body.vercelProject,
    );
    if (!parsedProject.success) {
      return Response.json(
        { error: "Invalid Vercel project" },
        { status: 400 },
      );
    }
    explicitVercelProject = parsedProject.data;
  }

  const {
    repoOwner,
    repoName,
    branch,
    cloneUrl,
    isNewBranch,
    sandboxType = "vercel",
    autoCommitPush,
    autoCreatePr,
  } = body;

  let finalBranch = branch;
  if (isNewBranch) {
    finalBranch = generateBranchName(session.user.username, session.user.name);
  }

  try {
    const titlePromise = resolveSessionTitle(body, session.user.id);
    const preferencesPromise = getUserPreferences(session.user.id);

    let resolvedVercelProject: VercelProjectSelection | null = null;
    const hasRepo = Boolean(repoOwner && repoName);
    if (hasRepo && repoOwner && repoName) {
      if (explicitVercelProject) {
        const vercelToken = await getUserVercelToken(session.user.id);
        if (!vercelToken) {
          return Response.json(
            { error: "Connect Vercel to select a Vercel project" },
            { status: 403 },
          );
        }

        const matchingProjects = await listMatchingVercelProjects({
          token: vercelToken,
          repoOwner,
          repoName,
        });
        const matchedProject =
          matchingProjects.find(
            (project) => project.projectId === explicitVercelProject.projectId,
          ) ?? null;
        if (!matchedProject) {
          return Response.json(
            {
              error:
                "Selected Vercel project no longer matches this repository",
            },
            { status: 400 },
          );
        }

        await upsertVercelProjectLink({
          userId: session.user.id,
          repoOwner,
          repoName,
          project: matchedProject,
        });
        resolvedVercelProject = matchedProject;
      } else if (explicitVercelProject === undefined) {
        resolvedVercelProject = await getVercelProjectLinkByRepo(
          session.user.id,
          repoOwner,
          repoName,
        );
      }
    }

    const [title, rawPreferences] = await Promise.all([
      titlePromise,
      preferencesPromise,
    ]);
    const preferences = sanitizeUserPreferencesForSession(
      rawPreferences,
      session,
      req.url,
    );
    const effectiveAutoCommitPush =
      autoCommitPush ?? preferences.autoCommitPush;
    const effectiveAutoCreatePr = autoCreatePr ?? preferences.autoCreatePr;
    const result = await createSessionWithInitialChat({
      session: {
        id: nanoid(),
        userId: session.user.id,
        title,
        status: "running",
        repoOwner,
        repoName,
        branch: finalBranch,
        cloneUrl,
        vercelProjectId: resolvedVercelProject?.projectId ?? null,
        vercelProjectName: resolvedVercelProject?.projectName ?? null,
        vercelTeamId: resolvedVercelProject?.teamId ?? null,
        vercelTeamSlug: resolvedVercelProject?.teamSlug ?? null,
        isNewBranch: isNewBranch ?? false,
        autoCommitPushOverride: effectiveAutoCommitPush,
        autoCreatePrOverride: effectiveAutoCommitPush
          ? effectiveAutoCreatePr
          : false,
        globalSkillRefs: preferences.globalSkillRefs,
        sandboxState: { type: sandboxType },
        lifecycleState: "provisioning",
        lifecycleVersion: 0,
      },
      initialChat: {
        id: nanoid(),
        title: "New chat",
        modelId: preferences.defaultModelId,
      },
    });

    return Response.json(result);
  } catch (error) {
    if (isVercelInvalidTokenError(error)) {
      console.warn(
        `Vercel token is invalid for user ${session.user.id}; reconnect required to create a session with env sync.`,
      );
      return Response.json(
        { error: "Reconnect Vercel to select a Vercel project" },
        { status: 403 },
      );
    }

    console.error("Failed to create session:", error);
    return Response.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
