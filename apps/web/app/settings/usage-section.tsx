"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ContributionChart } from "@/components/contribution-chart";
import { fetcher } from "@/lib/swr";

interface DailyUsageRow {
  date: string;
  source: "web" | "cli";
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface MergedDay {
  date: string;
  inputTokens: number;
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
      outputTokens: acc.outputTokens + d.outputTokens,
      messageCount: acc.messageCount + d.messageCount,
      toolCallCount: acc.toolCallCount + d.toolCallCount,
    }),
    { inputTokens: 0, outputTokens: 0, messageCount: 0, toolCallCount: 0 },
  );
}

/** Merge per-source rows into one row per date for the chart */
function mergeDays(rows: DailyUsageRow[]): MergedDay[] {
  const map = new Map<string, MergedDay>();
  for (const r of rows) {
    const existing = map.get(r.date);
    if (existing) {
      existing.inputTokens += r.inputTokens;
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
          Token consumption and activity over the past 40 weeks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[120px] w-full rounded-md" />
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

  const { webTotals, cliTotals, totals, chartData } = useMemo(() => {
    const usage = data?.usage ?? [];
    const web = usage.filter((r) => r.source === "web");
    const cli = usage.filter((r) => r.source === "cli");
    return {
      webTotals: sumRows(web),
      cliTotals: sumRows(cli),
      totals: sumRows(usage),
      chartData: mergeDays(usage),
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

  const hasWeb = webTotals.messageCount > 0;
  const hasCli = cliTotals.messageCount > 0;
  const hasBoth = hasWeb && hasCli;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          Token consumption and activity over the past 40 weeks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatBlock
            label="Total tokens"
            value={formatTokens(totalTokens)}
            detail={
              hasBoth
                ? `${formatTokens(webTokens)} web · ${formatTokens(cliTokens)} cli`
                : undefined
            }
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

        {/* Activity chart */}
        <ContributionChart data={chartData} />
      </CardContent>
    </Card>
  );
}
