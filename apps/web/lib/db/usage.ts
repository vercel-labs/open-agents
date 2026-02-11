import { isToolUIPart, type UIMessage } from "ai";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { usageEvents } from "./schema";

export type UsageSource = "web" | "cli";

export async function recordUsage(
  userId: string,
  data: {
    source: UsageSource;
    messages: UIMessage[];
    usage: { inputTokens: number; outputTokens: number };
  },
) {
  const toolCallCount = data.messages
    .flatMap((m) => m.parts)
    .filter(isToolUIPart).length;

  await db.insert(usageEvents).values({
    id: nanoid(),
    userId,
    source: data.source,
    inputTokens: data.usage.inputTokens,
    outputTokens: data.usage.outputTokens,
    toolCallCount,
  });
}

export interface DailyUsage {
  date: string;
  source: UsageSource;
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

export async function getUsageHistory(
  userId: string,
  days = 280,
): Promise<DailyUsage[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const rows = await db
    .select({
      date: sql<string>`date(${usageEvents.createdAt})`,
      source: usageEvents.source,
      inputTokens: sql<number>`sum(${usageEvents.inputTokens})::int`,
      outputTokens: sql<number>`sum(${usageEvents.outputTokens})::int`,
      messageCount: sql<number>`count(*)::int`,
      toolCallCount: sql<number>`sum(${usageEvents.toolCallCount})::int`,
    })
    .from(usageEvents)
    .where(
      sql`${usageEvents.userId} = ${userId} and ${usageEvents.createdAt} >= ${sinceIso}`,
    )
    .groupBy(sql`date(${usageEvents.createdAt})`, usageEvents.source)
    .orderBy(sql`date(${usageEvents.createdAt})`);

  return rows;
}
