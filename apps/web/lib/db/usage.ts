import { isToolUIPart, type LanguageModel, type UIMessage } from "ai";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { usageEvents } from "./schema";

export type UsageSource = "web" | "cli";

export async function recordUsage(
  userId: string,
  data: {
    source: UsageSource;
    model: LanguageModel;
    messages: UIMessage[];
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    };
  },
) {
  const toolCallCount = data.messages
    .flatMap((m) => m.parts)
    .filter(isToolUIPart).length;

  const provider =
    typeof data.model === "string"
      ? data.model.split("/")[0]
      : data.model.provider;
  const modelId =
    typeof data.model === "string" ? data.model : data.model.modelId;

  await db.insert(usageEvents).values({
    id: nanoid(),
    userId,
    source: data.source,
    provider: provider ?? null,
    modelId: modelId ?? null,
    inputTokens: data.usage.inputTokens,
    cachedInputTokens: data.usage.cachedInputTokens,
    outputTokens: data.usage.outputTokens,
    toolCallCount,
  });
}

export interface DailyUsage {
  date: string;
  source: UsageSource;
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
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
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      inputTokens: sql<number>`sum(${usageEvents.inputTokens})::int`,
      cachedInputTokens: sql<number>`sum(${usageEvents.cachedInputTokens})::int`,
      outputTokens: sql<number>`sum(${usageEvents.outputTokens})::int`,
      messageCount: sql<number>`count(*)::int`,
      toolCallCount: sql<number>`sum(${usageEvents.toolCallCount})::int`,
    })
    .from(usageEvents)
    .where(
      sql`${usageEvents.userId} = ${userId} and ${usageEvents.createdAt} >= ${sinceIso}`,
    )
    .groupBy(
      sql`date(${usageEvents.createdAt})`,
      usageEvents.source,
      usageEvents.provider,
      usageEvents.modelId,
    )
    .orderBy(sql`date(${usageEvents.createdAt})`);

  return rows;
}
