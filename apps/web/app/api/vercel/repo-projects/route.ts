import { getVercelProjectLinkByRepo } from "@/lib/db/vercel-project-links";
import { getServerSession } from "@/lib/session/get-server-session";
import { listMatchingVercelProjects } from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const repoOwner = searchParams.get("repoOwner")?.trim();
  const repoName = searchParams.get("repoName")?.trim();

  if (!repoOwner || !repoName) {
    return Response.json(
      { error: "Missing repoOwner or repoName" },
      { status: 400 },
    );
  }

  const token = await getUserVercelToken(session.user.id);
  if (!token) {
    return Response.json(
      { error: "Connect Vercel to load matching projects" },
      { status: 403 },
    );
  }

  try {
    const [savedLink, projects] = await Promise.all([
      getVercelProjectLinkByRepo(session.user.id, repoOwner, repoName),
      listMatchingVercelProjects({
        token,
        repoOwner,
        repoName,
      }),
    ]);

    const selectedProjectId =
      savedLink &&
      projects.some((project) => project.projectId === savedLink.projectId)
        ? savedLink.projectId
        : projects.length === 1
          ? (projects[0]?.projectId ?? null)
          : null;

    return Response.json({
      projects,
      selectedProjectId,
    });
  } catch (error) {
    console.error("Failed to load Vercel repo projects:", error);
    return Response.json(
      { error: "Failed to load Vercel projects" },
      { status: 500 },
    );
  }
}
