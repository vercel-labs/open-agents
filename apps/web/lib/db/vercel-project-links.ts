import { and, eq } from "drizzle-orm";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import { db } from "./client";
import { vercelProjectLinks } from "./schema";

function normalizeRepoCoordinate(value: string): string {
  return value.trim().toLowerCase();
}

export async function getVercelProjectLinkByRepo(
  userId: string,
  repoOwner: string,
  repoName: string,
): Promise<VercelProjectSelection | null> {
  const normalizedOwner = normalizeRepoCoordinate(repoOwner);
  const normalizedRepo = normalizeRepoCoordinate(repoName);

  const [row] = await db
    .select({
      projectId: vercelProjectLinks.projectId,
      projectName: vercelProjectLinks.projectName,
      teamId: vercelProjectLinks.teamId,
      teamSlug: vercelProjectLinks.teamSlug,
    })
    .from(vercelProjectLinks)
    .where(
      and(
        eq(vercelProjectLinks.userId, userId),
        eq(vercelProjectLinks.repoOwner, normalizedOwner),
        eq(vercelProjectLinks.repoName, normalizedRepo),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    projectId: row.projectId,
    projectName: row.projectName,
    teamId: row.teamId,
    teamSlug: row.teamSlug,
  };
}

export async function upsertVercelProjectLink(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  project: VercelProjectSelection;
}): Promise<void> {
  const normalizedOwner = normalizeRepoCoordinate(params.repoOwner);
  const normalizedRepo = normalizeRepoCoordinate(params.repoName);
  const now = new Date();

  await db
    .insert(vercelProjectLinks)
    .values({
      userId: params.userId,
      repoOwner: normalizedOwner,
      repoName: normalizedRepo,
      projectId: params.project.projectId,
      projectName: params.project.projectName,
      teamId: params.project.teamId,
      teamSlug: params.project.teamSlug,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        vercelProjectLinks.userId,
        vercelProjectLinks.repoOwner,
        vercelProjectLinks.repoName,
      ],
      set: {
        projectId: params.project.projectId,
        projectName: params.project.projectName,
        teamId: params.project.teamId,
        teamSlug: params.project.teamSlug,
        updatedAt: now,
      },
    });
}
