import { and, eq, sql } from "drizzle-orm";
import {
  buildUsageInsights,
  type UsageAggregateRow,
  type UsageSessionInsightRow,
} from "@/lib/usage/compute-insights";
import type { UsageInsights } from "@/lib/usage/types";
import { db } from "./client";
import { sessions, usageEvents } from "./schema";

const EMPTY_USAGE_AGGREGATE: UsageAggregateRow = {
  totalInputTokens: 0,
  totalCachedInputTokens: 0,
  totalOutputTokens: 0,
  totalToolCallCount: 0,
  mainInputTokens: 0,
  mainOutputTokens: 0,
  mainAssistantTurnCount: 0,
  largestMainTurnTokens: 0,
};

export async function getUsageInsights(
  userId: string,
  days = 280,
): Promise<UsageInsights> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const [aggregateRows, sessionRows] = await Promise.all([
    db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::int`,
        totalCachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::int`,
        totalToolCallCount: sql<number>`coalesce(sum(${usageEvents.toolCallCount}), 0)::int`,
        mainInputTokens: sql<number>`coalesce(sum(case when ${usageEvents.agentType} = 'main' then ${usageEvents.inputTokens} else 0 end), 0)::int`,
        mainOutputTokens: sql<number>`coalesce(sum(case when ${usageEvents.agentType} = 'main' then ${usageEvents.outputTokens} else 0 end), 0)::int`,
        mainAssistantTurnCount: sql<number>`coalesce(sum(case when ${usageEvents.agentType} = 'main' then 1 else 0 end), 0)::int`,
        largestMainTurnTokens: sql<number>`coalesce(max(case when ${usageEvents.agentType} = 'main' then ${usageEvents.inputTokens} + ${usageEvents.outputTokens} end), 0)::int`,
      })
      .from(usageEvents)
      .where(
        sql`${usageEvents.userId} = ${userId} and ${usageEvents.createdAt} >= ${sinceIso}`,
      ),
    db
      .select({
        repoOwner: sessions.repoOwner,
        repoName: sessions.repoName,
        prNumber: sessions.prNumber,
        prStatus: sessions.prStatus,
        linesAdded: sessions.linesAdded,
        linesRemoved: sessions.linesRemoved,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          sql`${sessions.createdAt} >= ${sinceIso}`,
        ),
      ),
  ]);

  const aggregate = aggregateRows[0] ?? EMPTY_USAGE_AGGREGATE;

  return buildUsageInsights({
    lookbackDays: days,
    aggregate,
    sessions: sessionRows as UsageSessionInsightRow[],
  });
}
