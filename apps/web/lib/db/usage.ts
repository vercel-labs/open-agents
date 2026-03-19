import { isToolUIPart, type LanguageModel, type UIMessage } from "ai";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { usageEvents } from "./schema";

export type UsageSource = "web";
export type UsageAgentType = "main" | "subagent";

export async function recordUsage(
  userId: string,
  data: {
    source: UsageSource;
    agentType?: UsageAgentType;
    model: LanguageModel | string;
    messages: UIMessage[];
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    };
    toolCallCount?: number;
  },
) {
  const inferredToolCallCount = data.messages
    .flatMap((m) => m.parts)
    .filter(isToolUIPart).length;
  const toolCallCount = data.toolCallCount ?? inferredToolCallCount;

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
    agentType: data.agentType ?? "main",
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
  agentType: UsageAgentType;
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
      agentType: usageEvents.agentType,
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      inputTokens: sql<number>`sum(${usageEvents.inputTokens})::int`,
      cachedInputTokens: sql<number>`sum(${usageEvents.cachedInputTokens})::int`,
      outputTokens: sql<number>`sum(${usageEvents.outputTokens})::int`,
      messageCount: sql<number>`sum(case when ${usageEvents.agentType} = 'main' then 1 else 0 end)::int`,
      toolCallCount: sql<number>`sum(${usageEvents.toolCallCount})::int`,
    })
    .from(usageEvents)
    .where(
      sql`${usageEvents.userId} = ${userId} and ${usageEvents.createdAt} >= ${sinceIso}`,
    )
    .groupBy(
      sql`date(${usageEvents.createdAt})`,
      usageEvents.source,
      usageEvents.agentType,
      usageEvents.provider,
      usageEvents.modelId,
    )
    .orderBy(sql`date(${usageEvents.createdAt})`);

  return rows;
}
