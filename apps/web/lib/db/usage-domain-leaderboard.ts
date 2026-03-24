import { eq, sql } from "drizzle-orm";
import type { UsageDateRange } from "@/lib/usage/date-range";
import type {
  UsageDomainLeaderboard,
  UsageDomainLeaderboardRow,
} from "@/lib/usage/types";
import { db } from "./client";
import { usageEvents, users } from "./schema";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "me.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
]);

const VERIFIED_USAGE_LEADERBOARD_DOMAINS = new Set(["vercel.com"]);

interface UsageDomainLeaderboardQueryRow {
  userId: string;
  email: string | null;
  username: string;
  name: string | null;
  modelId: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface UsageDomainLeaderboardOptions {
  days?: number;
  range?: UsageDateRange;
}

function buildUsageDomainLeaderboardWhereClause(
  domain: string,
  options?: UsageDomainLeaderboardOptions,
) {
  if (options?.range) {
    return sql`${users.email} is not null and lower(split_part(${users.email}, '@', 2)) = ${domain} and date(${usageEvents.createdAt}) >= ${options.range.from} and date(${usageEvents.createdAt}) <= ${options.range.to}`;
  }

  const days = options?.days ?? 280;
  const since = new Date();
  since.setDate(since.getDate() - days);

  return sql`${users.email} is not null and lower(split_part(${users.email}, '@', 2)) = ${domain} and ${usageEvents.createdAt} >= ${since.toISOString()}`;
}

export function getUsageLeaderboardDomain(
  email: string | null | undefined,
): string | null {
  if (!email) {
    return null;
  }

  const trimmedEmail = email.trim().toLowerCase();
  const atIndex = trimmedEmail.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmedEmail.length - 1) {
    return null;
  }

  const domain = trimmedEmail.slice(atIndex + 1);
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
    return null;
  }

  if (!VERIFIED_USAGE_LEADERBOARD_DOMAINS.has(domain)) {
    return null;
  }

  return domain;
}

function shouldReplaceMostUsedModel(params: {
  currentModelId: string | null;
  currentTokens: number;
  candidateModelId: string | null;
  candidateTokens: number;
}): boolean {
  const { currentModelId, currentTokens, candidateModelId, candidateTokens } =
    params;

  if (candidateTokens > currentTokens) {
    return true;
  }

  if (candidateTokens < currentTokens) {
    return false;
  }

  if (currentModelId === null && candidateModelId !== null) {
    return true;
  }

  if (currentModelId !== null && candidateModelId === null) {
    return false;
  }

  if (currentModelId === null || candidateModelId === null) {
    return false;
  }

  return candidateModelId < currentModelId;
}

export function buildUsageDomainLeaderboardRows(
  rows: UsageDomainLeaderboardQueryRow[],
): UsageDomainLeaderboardRow[] {
  const leaderboard = new Map<string, UsageDomainLeaderboardRow>();

  for (const row of rows) {
    if (!row.email) {
      continue;
    }

    const modelTokens = row.totalInputTokens + row.totalOutputTokens;
    const existing = leaderboard.get(row.userId);

    if (existing) {
      existing.totalTokens += modelTokens;
      if (
        shouldReplaceMostUsedModel({
          currentModelId: existing.mostUsedModelId,
          currentTokens: existing.mostUsedModelTokens,
          candidateModelId: row.modelId,
          candidateTokens: modelTokens,
        })
      ) {
        existing.mostUsedModelId = row.modelId;
        existing.mostUsedModelTokens = modelTokens;
      }
      continue;
    }

    leaderboard.set(row.userId, {
      userId: row.userId,
      username: row.username,
      name: row.name,
      totalTokens: modelTokens,
      mostUsedModelId: row.modelId,
      mostUsedModelTokens: modelTokens,
    });
  }

  return [...leaderboard.values()]
    .filter((row) => row.totalTokens > 0)
    .toSorted((a, b) => {
      if (b.totalTokens !== a.totalTokens) {
        return b.totalTokens - a.totalTokens;
      }

      const usernameOrder = a.username.localeCompare(b.username);
      if (usernameOrder !== 0) {
        return usernameOrder;
      }

      return a.userId.localeCompare(b.userId);
    });
}

export async function getUsageDomainLeaderboard(
  email: string | null | undefined,
  options?: UsageDomainLeaderboardOptions,
): Promise<UsageDomainLeaderboard | null> {
  const domain = getUsageLeaderboardDomain(email);
  if (!domain) {
    return null;
  }

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      username: users.username,
      name: users.name,
      modelId: usageEvents.modelId,
      totalInputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::double precision`,
      totalOutputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::double precision`,
    })
    .from(usageEvents)
    .innerJoin(users, eq(usageEvents.userId, users.id))
    .where(buildUsageDomainLeaderboardWhereClause(domain, options))
    .groupBy(
      users.id,
      users.email,
      users.username,
      users.name,
      usageEvents.modelId,
    );

  return {
    domain,
    rows: buildUsageDomainLeaderboardRows(rows),
  };
}
