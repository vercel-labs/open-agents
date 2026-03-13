"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { DateRange } from "react-day-picker";
import { ContributionChart } from "@/components/contribution-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/swr";

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
}

function formatTokens(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
                className="flex items-center gap-2 text-sm"
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: segment.color }}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-medium">{segment.label}</span>
                  {segment.detail ? (
                    <span className="text-xs text-muted-foreground">
                      {segment.detail}
                    </span>
                  ) : null}
                </div>
                <span className="ml-auto text-muted-foreground">
                  {formatTokens(segment.value)}
                </span>
                <span className="text-muted-foreground">({share}%)</span>
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
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {detail ? (
        <div className="text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

export function UsageSection() {
  const { data, isLoading, error } = useSWR<UsageResponse>(
    "/api/usage",
    fetcher,
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const { totals, chartData, modelUsage, mainTotals, subagentTotals } =
    useMemo(() => {
      let usage = data?.usage ?? [];

      if (dateRange?.from) {
        const fromStr = toDateStr(dateRange.from);
        const toStr = dateRange.to ? toDateStr(dateRange.to) : fromStr;
        usage = usage.filter((r) => r.date >= fromStr && r.date <= toStr);
      }

      const main = usage.filter((r) => r.agentType === "main");
      const subagent = usage.filter((r) => r.agentType === "subagent");
      return {
        totals: sumRows(usage),
        chartData: mergeDays(usage),
        modelUsage: aggregateByModel(usage),
        mainTotals: sumRows(main),
        subagentTotals: sumRows(subagent),
      };
    }, [data, dateRange]);

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

  const hasUsage = totals.messageCount > 0;
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Usage</CardTitle>
            <CardDescription>
              {dateRange?.from
                ? "Showing filtered results."
                : "Token consumption and activity over the past 39 weeks."}
            </CardDescription>
          </div>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <StatBlock label="Total tokens" value={formatTokens(totalTokens)} />
          <StatBlock
            label="Messages"
            value={totals.messageCount.toLocaleString()}
          />
          <StatBlock
            label="Tool calls"
            value={totals.toolCallCount.toLocaleString()}
          />
        </div>

        <ContributionChart data={chartData} />

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
  );
}
