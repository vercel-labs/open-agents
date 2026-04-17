"use client";

import { formatTokens } from "@open-harness/shared";
import { useMemo, useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import type { DateRange } from "react-day-picker";
import { ContributionChart } from "@/components/contribution-chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { estimateModelUsageCost, type AvailableModel } from "@/lib/models";
import { fetcher } from "@/lib/swr";
import { formatDateOnly } from "@/lib/usage/date-range";
import type {
  UsageDomainLeaderboard,
  UsageInsights,
  UsageRepositoryInsight,
} from "@/lib/usage/types";
import { UsageInsightsSection } from "../usage/usage-insights-section";

// ── Types ──────────────────────────────────────────────────────────────────

interface DailyUsageRow {
  date: string;
  source: "web";
  agentType: "main" | "subagent";
  provider: string | null;
  modelId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
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

interface ModelUsage {
  modelId: string;
  provider: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface UsageResponse {
  usage: DailyUsageRow[];
  insights: UsageInsights;
  domainLeaderboard: UsageDomainLeaderboard | null;
}

interface ModelsResponse {
  models: AvailableModel[];
}

interface CostEstimateSummary {
  amount: number;
  pricedTokens: number;
  totalTokens: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
      map.set(r.date, {
        date: r.date,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        messageCount: r.messageCount,
        toolCallCount: r.toolCallCount,
      });
    }
  }
  return [...map.values()];
}

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

function displayModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

function formatUsd(amount: number): string {
  if (amount >= 100) {
    return "$" + amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (amount >= 1) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  if (amount >= 0.01) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    "$" +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  );
}

function estimateUsageCost(
  modelUsage: ModelUsage[],
  models: AvailableModel[],
): CostEstimateSummary | undefined {
  let amount = 0;
  let pricedTokens = 0;
  let totalTokens = 0;
  const modelsById = new Map(models.map((model) => [model.id, model]));

  for (const usage of modelUsage) {
    const modelTotalTokens = usage.inputTokens + usage.outputTokens;
    totalTokens += modelTotalTokens;

    const cost = estimateModelUsageCost(
      usage,
      modelsById.get(usage.modelId)?.cost,
    );
    if (cost === undefined) {
      continue;
    }

    amount += cost;
    pricedTokens += modelTotalTokens;
  }

  if (totalTokens <= 0) {
    return undefined;
  }

  return {
    amount,
    pricedTokens,
    totalTokens,
  };
}

// Gray-scale dot classes: brightest first (top rank), darkest last
const RANK_DOT_CLASSES = [
  "bg-neutral-100 dark:bg-neutral-200",
  "bg-neutral-300 dark:bg-neutral-400",
  "bg-neutral-400 dark:bg-neutral-500",
  "bg-neutral-500 dark:bg-neutral-600",
  "bg-neutral-600 dark:bg-neutral-700",
];

// ── Sub-components ─────────────────────────────────────────────────────────

function StatItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold font-mono tabular-nums">
          {value}
        </span>
      </div>
      {detail ? (
        <div className="mt-1 text-right text-[11px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

/** Ranked list with grayscale dots — used for agent split, model usage, code churn */
function RankedList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; subtext?: string }[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={item.label} className="flex items-center gap-2.5 text-sm">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${RANK_DOT_CLASSES[i % RANK_DOT_CLASSES.length]}`}
            />
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top repos for sidebar ──────────────────────────────────────────────────

function TopRepos({ repos }: { repos: UsageRepositoryInsight[] }) {
  const top3 = repos.slice(0, 3);
  if (top3.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Top repositories
      </h3>
      <div className="space-y-2">
        {top3.map((repo) => (
          <div
            key={`${repo.repoOwner}/${repo.repoName}`}
            className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              <p className="truncate text-sm font-medium">
                {repo.repoOwner}/{repo.repoName}
              </p>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                {repo.sessionCount.toLocaleString()} sessions
              </span>
              <span className="font-mono tabular-nums">
                {repo.totalLinesChanged.toLocaleString()} lines
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Profile sidebar (left column) ──────────────────────────────────────────

function ProfileSidebar({
  totals,
  topRepos,
  estimatedCostValue,
  vercelRank,
  orgLabel,
}: {
  totals: {
    inputTokens: number;
    outputTokens: number;
    messageCount: number;
    toolCallCount: number;
  } | null;
  topRepos: UsageRepositoryInsight[] | null;
  estimatedCostValue: string;
  vercelRank: number | null;
  orgLabel: string | null;
}) {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  if (!session?.user) return null;

  const totalTokens = totals ? totals.inputTokens + totals.outputTokens : 0;

  return (
    <div className="space-y-5">
      {/* Avatar + name — left-aligned */}
      <div className="flex items-center gap-3">
        {session.user.avatar && (
          <Image
            src={session.user.avatar}
            alt={session.user.username}
            width={56}
            height={56}
            className="shrink-0 rounded-full"
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">
            {session.user.name ?? session.user.username}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            @{session.user.username}
          </p>
        </div>
      </div>

      {/* Rank + Email */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {vercelRank && orgLabel
            ? `#${vercelRank} in ${orgLabel}`
            : orgLabel
              ? `${orgLabel} rank unavailable`
              : "Org rank unavailable"}
        </p>
        {session.user.email && (
          <p className="truncate text-sm text-muted-foreground">
            {session.user.email}
          </p>
        )}
      </div>

      {/* Stats */}
      {totals && (
        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Usage
          </h3>
          <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-1 divide-y divide-border/50">
            <StatItem label="Total tokens" value={formatTokens(totalTokens)} />
            <StatItem label="Estimated cost" value={estimatedCostValue} />
            <StatItem
              label="Messages"
              value={totals.messageCount.toLocaleString()}
            />
            <StatItem
              label="Tool calls"
              value={totals.toolCallCount.toLocaleString()}
            />
          </div>
        </div>
      )}

      {/* Top repos */}
      {topRepos && <TopRepos repos={topRepos} />}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const { session } = useSession();

  const filteredUsagePath = useMemo(() => {
    if (!dateRange?.from) return null;
    const from = formatDateOnly(dateRange.from);
    const to = formatDateOnly(dateRange.to ?? dateRange.from);
    const query = new URLSearchParams({ from, to });
    return `/api/usage?${query.toString()}`;
  }, [dateRange]);

  const {
    data: fullData,
    isLoading: isFullDataLoading,
    error: fullDataError,
  } = useSWR<UsageResponse>("/api/usage", fetcher);
  const {
    data: filteredData,
    isLoading: isFilteredDataLoading,
    error: filteredDataError,
  } = useSWR<UsageResponse>(filteredUsagePath, fetcher);
  const { data: modelsData } = useSWR<ModelsResponse>("/api/models", fetcher);

  const data = filteredUsagePath ? filteredData : fullData;
  const isLoading =
    isFullDataLoading || (filteredUsagePath !== null && isFilteredDataLoading);
  const error = fullDataError ?? filteredDataError;

  const {
    totals,
    chartData,
    modelUsage,
    mainTotals,
    subagentTotals,
    costEstimate,
  } = useMemo(() => {
    const selectedUsage = data?.usage ?? [];
    const chartUsage = fullData?.usage ?? selectedUsage;
    const aggregatedModelUsage = aggregateByModel(selectedUsage);
    const main = selectedUsage.filter((r) => r.agentType === "main");
    const subagent = selectedUsage.filter((r) => r.agentType === "subagent");
    return {
      totals: sumRows(selectedUsage),
      chartData: mergeDays(chartUsage),
      modelUsage: aggregatedModelUsage,
      mainTotals: sumRows(main),
      subagentTotals: sumRows(subagent),
      costEstimate: estimateUsageCost(
        aggregatedModelUsage,
        modelsData?.models ?? [],
      ),
    };
  }, [data, fullData, modelsData]);

  const mainTokens = mainTotals.inputTokens + mainTotals.outputTokens;
  const subagentTokens =
    subagentTotals.inputTokens + subagentTotals.outputTokens;
  const hasUsage = totals.messageCount > 0;
  const estimatedCostValue =
    costEstimate && costEstimate.pricedTokens > 0
      ? formatUsd(costEstimate.amount)
      : "—";

  // Build ranked-list items for agent split
  const agentItems = [
    { label: "Main agent", value: formatTokens(mainTokens) },
    { label: "Subagents", value: formatTokens(subagentTokens) },
  ].filter((i) => i.value !== "0");

  // Build ranked-list items for model usage (top 5)
  const modelItems = modelUsage.slice(0, 5).map((m) => ({
    label: displayModelId(m.modelId),
    value: formatTokens(m.inputTokens + m.outputTokens),
  }));

  // Build ranked-list items for code churn
  const codeChurnItems = data?.insights
    ? [
        {
          label: "Lines added",
          value: data.insights.code.linesAdded.toLocaleString(),
        },
        {
          label: "Lines removed",
          value: data.insights.code.linesRemoved.toLocaleString(),
        },
        {
          label: "Total changed",
          value: data.insights.code.totalLinesChanged.toLocaleString(),
        },
      ]
    : [];

  const dateRangeLabel = dateRange?.from
    ? (() => {
        const fromLabel = dateRange.from.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const toDate = dateRange.to ?? dateRange.from;
        const toLabel = toDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        return fromLabel === toLabel
          ? `Activity for ${fromLabel}`
          : `${fromLabel} – ${toLabel}`;
      })()
    : null;

  const topRepos = data?.insights?.topRepositories ?? null;
  const allTimeLeaderboard = fullData?.domainLeaderboard ?? null;
  const vercelRank = useMemo(() => {
    const userId = session?.user?.id;
    if (!allTimeLeaderboard || !userId) {
      return null;
    }

    const index = allTimeLeaderboard.rows.findIndex(
      (row) => row.userId === userId,
    );
    return index >= 0 ? index + 1 : null;
  }, [allTimeLeaderboard, session?.user?.id]);
  const orgLabel = useMemo(() => {
    const domain = allTimeLeaderboard?.domain?.trim();
    if (!domain) {
      return null;
    }

    const [orgName] = domain.split(".");
    if (!orgName) {
      return domain;
    }

    return orgName.charAt(0).toUpperCase() + orgName.slice(1);
  }, [allTimeLeaderboard?.domain]);

  return (
    <>
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        {/* Left sidebar */}
        <div className="w-full shrink-0 lg:w-56">
          <ProfileSidebar
            totals={isLoading ? null : totals}
            topRepos={isLoading ? null : topRepos}
            estimatedCostValue={estimatedCostValue}
            vercelRank={vercelRank}
            orgLabel={orgLabel}
          />
        </div>

        {/* Right content */}
        <div className="min-w-0 flex-1 space-y-8">
          {/* Activity grid */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Activity
              </h2>
              {dateRangeLabel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 py-0 text-xs text-muted-foreground"
                  onClick={() => setDateRange(undefined)}
                >
                  {dateRangeLabel} · Clear
                </Button>
              )}
            </div>
            {isLoading ? (
              <Skeleton className="h-[96px] w-full rounded-md" />
            ) : (
              <ContributionChart
                data={chartData}
                selectedRange={dateRange}
                onSelectRange={setDateRange}
              />
            )}
          </div>

          {/* Usage breakdown — ranked lists in a grid */}
          {isLoading ? (
            <div className="grid gap-6 sm:grid-cols-3">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-28 rounded-xl" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              Failed to load usage data.
            </p>
          ) : (
            <>
              {(hasUsage ||
                modelItems.length > 0 ||
                codeChurnItems.length > 0) && (
                <div className="grid gap-8 sm:grid-cols-3">
                  {hasUsage && (
                    <RankedList title="Agent split" items={agentItems} />
                  )}
                  {modelItems.length > 0 && (
                    <RankedList title="Top models" items={modelItems} />
                  )}
                  {codeChurnItems.length > 0 && (
                    <RankedList title="Code churn" items={codeChurnItems} />
                  )}
                </div>
              )}

              {/* Insights */}
              {data?.insights ? (
                <UsageInsightsSection insights={data.insights} />
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
