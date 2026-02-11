"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { ContributionChart } from "@/components/contribution-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetcher } from "@/lib/swr";

interface DailyUsageRow {
  date: string;
  source: "web" | "cli";
  agentType: "main" | "subagent";
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface ModelUsage {
  modelId: string;
  provider: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface MergedDay {
  date: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface UsageResponse {
  usage: DailyUsageRow[];
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function sumRows(rows: DailyUsageRow[]) {
  return rows.reduce(
    (acc, d) => ({
      inputTokens: acc.inputTokens + d.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + d.cachedInputTokens,
      outputTokens: acc.outputTokens + d.outputTokens,
      messageCount: acc.messageCount + d.messageCount,
      toolCallCount: acc.toolCallCount + d.toolCallCount,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      messageCount: 0,
      toolCallCount: 0,
    },
  );
}

/** Aggregate rows by model across all dates */
function aggregateByModel(rows: DailyUsageRow[]): ModelUsage[] {
  const map = new Map<string, ModelUsage>();
  for (const r of rows) {
    if (!r.modelId) continue;
    const existing = map.get(r.modelId);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.cachedInputTokens += r.cachedInputTokens;
      existing.outputTokens += r.outputTokens;
      existing.messageCount += r.messageCount;
      existing.toolCallCount += r.toolCallCount;
    } else {
      map.set(r.modelId, {
        modelId: r.modelId,
        provider: r.provider ?? "unknown",
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
        messageCount: r.messageCount,
        toolCallCount: r.toolCallCount,
      });
    }
  }
  return [...map.values()].toSorted(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );
}

/** Strip provider prefix from model ID (e.g. "anthropic/claude-haiku-4.5" → "claude-haiku-4.5") */
function displayModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

/** Merge per-source rows into one row per date for the chart */
function mergeDays(rows: DailyUsageRow[]): MergedDay[] {
  const map = new Map<string, MergedDay>();
  for (const r of rows) {
    const existing = map.get(r.date);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.cachedInputTokens += r.cachedInputTokens;
      existing.outputTokens += r.outputTokens;
      existing.messageCount += r.messageCount;
      existing.toolCallCount += r.toolCallCount;
    } else {
      map.set(r.date, { ...r });
    }
  }
  return [...map.values()];
}

export function UsageSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          Token consumption and activity over the past 39 weeks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary stats - match StatBlock: text-xs + text-lg + text-xs */}
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="text-xs">
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="text-lg">
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="text-xs">
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>

        {/* Activity chart - match ContributionChart exact layout height */}
        <div className="flex flex-col gap-1">
          {/* Month labels row */}
          <div className="h-4" />
          {/* Grid: 7 * (12 + 2) - 2 = 96 */}
          <Skeleton className="h-[96px] w-full rounded-md" />
          {/* Legend row */}
          <div className="mt-1 h-3" />
        </div>

        {/* Model breakdown */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Skeleton className="h-3 w-10" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-3 w-14" />
                </TableHead>
                <TableHead className="text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </TableHead>
                <TableHead className="text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-4 w-32" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-4 w-10" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

export function UsageSection() {
  const { data, isLoading, error } = useSWR<UsageResponse>(
    "/api/usage",
    fetcher,
  );

  const {
    webTotals,
    cliTotals,
    totals,
    chartData,
    modelUsage,
    mainTotals,
    subagentTotals,
  } = useMemo(() => {
    const usage = data?.usage ?? [];
    const web = usage.filter((r) => r.source === "web");
    const cli = usage.filter((r) => r.source === "cli");
    const main = usage.filter((r) => r.agentType === "main");
    const subagent = usage.filter((r) => r.agentType === "subagent");
    return {
      webTotals: sumRows(web),
      cliTotals: sumRows(cli),
      totals: sumRows(usage),
      chartData: mergeDays(usage),
      modelUsage: aggregateByModel(usage),
      mainTotals: sumRows(main),
      subagentTotals: sumRows(subagent),
    };
  }, [data]);

  if (isLoading) return <UsageSectionSkeleton />;

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load usage data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalTokens = totals.inputTokens + totals.outputTokens;
  const webTokens = webTotals.inputTokens + webTotals.outputTokens;
  const cliTokens = cliTotals.inputTokens + cliTotals.outputTokens;
  const mainTokens = mainTotals.inputTokens + mainTotals.outputTokens;
  const subagentTokens =
    subagentTotals.inputTokens + subagentTotals.outputTokens;

  const hasWeb = webTotals.messageCount > 0;
  const hasCli = cliTotals.messageCount > 0;
  const hasBoth = hasWeb && hasCli;
  const hasSubagent = subagentTotals.messageCount > 0;
  const hasUsage = totals.messageCount > 0;

  const tokenDetailParts: string[] = [];
  if (hasBoth) {
    tokenDetailParts.push(
      `${formatTokens(webTokens)} web · ${formatTokens(cliTokens)} cli`,
    );
  }
  if (hasSubagent) {
    tokenDetailParts.push(
      `${formatTokens(mainTokens)} main · ${formatTokens(subagentTokens)} subagent`,
    );
  }
  const tokenDetail =
    tokenDetailParts.length > 0 ? tokenDetailParts.join(" · ") : undefined;
  const hasTokenTotal = totalTokens > 0;
  const mainShare =
    hasUsage && hasTokenTotal
      ? Math.round((mainTokens / totalTokens) * 100)
      : 0;
  const subagentShare =
    hasUsage && hasTokenTotal ? Math.max(0, 100 - mainShare) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          Token consumption and activity over the past 39 weeks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatBlock
            label="Total tokens"
            value={formatTokens(totalTokens)}
            detail={tokenDetail}
          />
          <StatBlock
            label="Messages"
            value={totals.messageCount.toLocaleString()}
            detail={
              hasBoth
                ? `${webTotals.messageCount} web · ${cliTotals.messageCount} cli`
                : undefined
            }
          />
          <StatBlock
            label="Tool calls"
            value={totals.toolCallCount.toLocaleString()}
            detail={
              hasBoth
                ? `${webTotals.toolCallCount} web · ${cliTotals.toolCallCount} cli`
                : undefined
            }
          />
        </div>

        {/* Agent split */}
        {hasUsage && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Agent split</h3>
            <div className="grid grid-cols-2 gap-4">
              <StatBlock
                label="Main agent"
                value={formatTokens(mainTokens)}
                detail={`${mainShare}% of total`}
              />
              <StatBlock
                label="Subagents"
                value={formatTokens(subagentTokens)}
                detail={`${subagentShare}% of total`}
              />
            </div>
          </div>
        )}

        {/* Activity chart */}
        <ContributionChart data={chartData} />

        {/* Model breakdown */}
        {modelUsage.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Usage by model</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Input tokens</TableHead>
                  <TableHead className="text-right">Output tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelUsage.map((m) => (
                  <TableRow key={m.modelId}>
                    <TableCell className="font-medium">
                      {displayModelId(m.modelId)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.provider}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatTokens(m.inputTokens)}
                      {m.cachedInputTokens > 0
                        ? ` (${formatTokens(m.cachedInputTokens)} cached)`
                        : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatTokens(m.outputTokens)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No model data</p>
        )}
      </CardContent>
    </Card>
  );
}
