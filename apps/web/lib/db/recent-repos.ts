import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "./client";
import { sessions } from "./schema";

export interface RecentRepoRecord {
  owner: string;
  repo: string;
  lastUsedAt: Date;
}

interface GetRecentReposByUserIdOptions {
  owner?: string;
  limit?: number;
}

function normalizeRecentRepoDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 5;
  }

  return Math.max(1, Math.min(limit, 20));
}

export async function getRecentReposByUserId(
  userId: string,
  options?: GetRecentReposByUserIdOptions,
): Promise<RecentRepoRecord[]> {
  const normalizedLimit = normalizeLimit(options?.limit);
  const ownerFilter = options?.owner?.trim().toLowerCase();
  const lastUsedAt =
    sql<Date>`max(coalesce(${sessions.lastActivityAt}, ${sessions.createdAt}))`.as(
      "last_used_at",
    );

  const rows = await db
    .select({
      owner: sessions.repoOwner,
      repo: sessions.repoName,
      lastUsedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNotNull(sessions.repoOwner),
        isNotNull(sessions.repoName),
        ownerFilter
          ? sql`lower(${sessions.repoOwner}) = ${ownerFilter}`
          : undefined,
      ),
    )
    .groupBy(sessions.repoOwner, sessions.repoName)
    .orderBy(desc(lastUsedAt), asc(sessions.repoOwner), asc(sessions.repoName))
    .limit(normalizedLimit);

  return rows.flatMap((row) => {
    if (!row.owner || !row.repo) {
      return [];
    }

    const lastUsedAtDate = normalizeRecentRepoDate(row.lastUsedAt);
    if (!lastUsedAtDate) {
      return [];
    }

    return [
      {
        owner: row.owner,
        repo: row.repo,
        lastUsedAt: lastUsedAtDate,
      },
    ];
  });
}
