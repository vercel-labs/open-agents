"use client";

import { formatTokens } from "@open-harness/shared";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { DateRange } from "react-day-picker";
import { ContributionChart } from "@/components/contribution-chart";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { estimateModelUsageCost, type AvailableModel } from "@/lib/models";
import { fetcher } from "@/lib/swr";
import { formatDateOnly } from "@/lib/usage/date-range";
import type { UsageDomainLeaderboard, UsageInsights } from "@/lib/usage/types";
import { UsageInsightsSection } from "./usage/usage-insights-section";

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

interface PieSegment {
  label: string;
  value: number;
  color: string;
  detail?: string;
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

function formatDateRangeLabel(range: DateRange | undefined) {
  if (!range?.from) {
    return "Token consumption and activity over the past 39 weeks. Click the chart to filter.";
  }

  const fromLabel = range.from.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const toDate = range.to ?? range.from;
  const toLabel = toDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (fromLabel === toLabel) {
    return `Showing activity for ${fromLabel}. Click another day to extend the range.`;
  }

  return `Showing activity from ${fromLabel} to ${toLabel}.`;
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

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function buildPieSegment(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const startOuter = polarToCartesian(centerX, centerY, radius, endAngle);
  const endOuter = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${centerX} ${centerY}`,
    `L ${startOuter.x} ${startOuter.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    "Z",
  ].join(" ");
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

function getCostEstimateDetail(
  costEstimate: CostEstimateSummary | undefined,
  isPricingLoading: boolean,
): string {
  if (isPricingLoading) {
    return "Loading model pricing";
  }

  if (!costEstimate) {
    return "No model usage";
  }

  if (costEstimate.pricedTokens <= 0) {
    return "No pricing available for used models";
  }

  if (costEstimate.pricedTokens >= costEstimate.totalTokens) {
    return "Estimated from models.dev pricing";
  }

  return `Estimated from ${Math.round((costEstimate.pricedTokens / costEstimate.totalTokens) * 100)}% of tokens with known pricing`;
}

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
        <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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

        <div className="flex flex-col gap-1">
          <div className="h-4" />
          <Skeleton className="h-[96px] w-full rounded-md" />
          <div className="mt-1 h-3" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 3 }).map((_, sectionIndex) => (
            <div key={sectionIndex} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <div className="grid gap-4 md:grid-cols-[160px,1fr]">
                <Skeleton className="h-36 w-36 rounded-full" />
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UsagePieChart({
  segments,
  centerLabel,
  emptyLabel,
}: {
  segments: PieSegment[];
  centerLabel: string;
  emptyLabel: string;
}) {
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  const total = visibleSegments.reduce(
    (sum, segment) => sum + segment.value,
    0,
  );
  const [hoveredSegment, setHoveredSegment] = useState<PieSegment | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const size = 120;
  const center = size / 2;
  const radius = 60;
  let currentAngle = 0;
  const singleSegment =
    visibleSegments.length === 1 ? visibleSegments[0] : undefined;

  return (
    <div className="grid gap-4 md:grid-cols-[160px,1fr]">
      <div className="relative mx-auto h-36 w-36">
        <div className="absolute inset-0 rounded-full ring-1 ring-border" />
        {visibleSegments.length === 0 ? (
          <div className="absolute inset-0 rounded-full bg-muted" />
        ) : (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={centerLabel}
          >
            {singleSegment ? (
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill={singleSegment.color}
                className="cursor-pointer"
                role="img"
                aria-label={
                  singleSegment.detail
                    ? `${singleSegment.label} · ${singleSegment.detail}`
                    : singleSegment.label
                }
                onMouseEnter={() => setHoveredSegment(singleSegment)}
                onMouseLeave={() => setHoveredSegment(null)}
                onMouseMove={(event) => {
                  const svg = event.currentTarget.ownerSVGElement;
                  const rect = svg ? svg.getBoundingClientRect() : null;
                  if (!rect) return;
                  setTooltipPosition({
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  });
                }}
              />
            ) : (
              visibleSegments.map((segment) => {
                const startAngle = currentAngle;
                const angle = (segment.value / total) * 360;
                const endAngle = startAngle + angle;
                currentAngle = endAngle;
                const path = buildPieSegment(
                  center,
                  center,
                  radius,
                  startAngle,
                  endAngle,
                );
                const tooltipLabel = segment.detail
                  ? `${segment.label} · ${segment.detail}`
                  : segment.label;
                return (
                  <path
                    key={segment.label}
                    d={path}
                    fill={segment.color}
                    className="cursor-pointer"
                    role="img"
                    aria-label={tooltipLabel}
                    onMouseEnter={() => setHoveredSegment(segment)}
                    onMouseLeave={() => setHoveredSegment(null)}
                    onMouseMove={(event) => {
                      const svg = event.currentTarget.ownerSVGElement;
                      const rect = svg ? svg.getBoundingClientRect() : null;
                      if (!rect) return;
                      setTooltipPosition({
                        x: event.clientX - rect.left,
                        y: event.clientY - rect.top,
                      });
                    }}
                  />
                );
              })
            )}
          </svg>
        )}
        {hoveredSegment ? (
          <div
            className="pointer-events-none absolute z-10 w-fit whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-sm"
            style={{
              left: Math.min(tooltipPosition.x + 12, size - 8),
              top: Math.min(tooltipPosition.y + 12, size - 8),
            }}
          >
            <div className="font-medium">{hoveredSegment.label}</div>
            <div>{formatTokens(hoveredSegment.value)} tokens</div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {visibleSegments.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          visibleSegments.map((segment) => {
            const share =
              total > 0 ? Math.round((segment.value / total) * 100) : 0;
            return (
              <div
                key={segment.label}
                className="flex items-start gap-2 text-sm"
              >
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: segment.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium leading-snug">
                    {segment.label}
                  </div>
                  {segment.detail ? (
                    <div className="text-xs text-muted-foreground">
                      {segment.detail}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground sm:text-sm">
                  <div>{formatTokens(segment.value)}</div>
                  <div>({share}%)</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
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
    <div className="min-w-0 rounded-xl border border-border/50 bg-muted/20 p-3 sm:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold leading-tight sm:text-xl">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs leading-snug text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export function UsageSection() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const filteredUsagePath = useMemo(() => {
    if (!dateRange?.from) {
      return null;
    }

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
  const { data: modelsData, isLoading: isModelsLoading } =
    useSWR<ModelsResponse>("/api/models", fetcher);

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
  const mainTokens = mainTotals.inputTokens + mainTotals.outputTokens;
  const subagentTokens =
    subagentTotals.inputTokens + subagentTotals.outputTokens;

  const hasUsage = totalTokens > 0 || totals.messageCount > 0;
  const costEstimateValue =
    costEstimate && costEstimate.pricedTokens > 0
      ? formatUsd(costEstimate.amount)
      : "—";
  const costEstimateDetail = hasUsage
    ? getCostEstimateDetail(costEstimate, isModelsLoading)
    : "No usage yet";
  const agentSegments: PieSegment[] = [
    {
      label: "Main agent",
      value: mainTokens,
      color: CHART_COLORS[0] ?? "var(--chart-1)",
    },
    {
      label: "Subagents",
      value: subagentTokens,
      color: CHART_COLORS[1] ?? "var(--chart-2)",
    },
  ];

  const modelSegments = (() => {
    const totalsByModel = modelUsage.map((m) => ({
      modelId: m.modelId,
      provider: m.provider,
      totalTokens: m.inputTokens + m.outputTokens,
    }));

    const topModels = totalsByModel
      .filter((m) => m.totalTokens > 0)
      .slice(0, 5);

    const otherTotal = totalsByModel
      .slice(5)
      .reduce((sum, m) => sum + m.totalTokens, 0);

    const segments: PieSegment[] = topModels.map((m, index) => ({
      label: displayModelId(m.modelId),
      value: m.totalTokens,
      color: CHART_COLORS[index % CHART_COLORS.length] ?? "var(--chart-1)",
    }));

    if (otherTotal > 0) {
      segments.push({
        label: "Other",
        value: otherTotal,
        color: "var(--muted-foreground)",
      });
    }

    return segments;
  })();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Usage</CardTitle>
              <CardDescription>
                {formatDateRangeLabel(dateRange)}
              </CardDescription>
            </div>
            {dateRange?.from ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start px-0 text-muted-foreground"
                onClick={() => setDateRange(undefined)}
              >
                Clear filter
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <StatBlock label="Total tokens" value={formatTokens(totalTokens)} />
            <StatBlock
              label="Estimated cost"
              value={costEstimateValue}
              detail={costEstimateDetail}
            />
            <StatBlock
              label="Messages"
              value={totals.messageCount.toLocaleString()}
            />
            <StatBlock
              label="Tool calls"
              value={totals.toolCallCount.toLocaleString()}
            />
          </div>

          <ContributionChart
            data={chartData}
            selectedRange={dateRange}
            onSelectRange={setDateRange}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            {hasUsage && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Agent split</h3>
                <UsagePieChart
                  segments={agentSegments}
                  centerLabel="Total tokens"
                  emptyLabel="No agent usage"
                />
              </div>
            )}

            {modelUsage.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Usage by model</h3>
                <UsagePieChart
                  segments={modelSegments}
                  centerLabel="Total tokens"
                  emptyLabel="No model usage"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No model data</p>
            )}
          </div>
        </CardContent>
      </Card>

      {data?.insights ? (
        <UsageInsightsSection insights={data.insights} />
      ) : null}
    </div>
  );
}
