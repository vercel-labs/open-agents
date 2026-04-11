import { formatTokens } from "@open-harness/shared/lib/tool-state";
import type { UsageInsights } from "@/lib/usage/types";

interface UsageInsightsSectionProps {
  insights: UsageInsights;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function formatDecimal(value: number): string {
  return value.toFixed(1);
}

function formatLookbackLabel(lookbackDays: number): string {
  if (lookbackDays <= 1) return "1 day";
  if (lookbackDays < 14) return `${lookbackDays} days`;
  const lookbackWeeks = Math.round(lookbackDays / 7);
  return `${lookbackWeeks} weeks`;
}

export function UsageInsightsSection({ insights }: UsageInsightsSectionProps) {
  const lookbackLabel = formatLookbackLabel(insights.lookbackDays);
  const prDetail = `${insights.pr.mergedPrCount} merged · ${insights.pr.openPrCount} open`;

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">
          Insights · last {lookbackLabel}
        </h2>
      </div>

      {/* Metrics grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Tracked PRs"
          value={insights.pr.trackedPrCount.toLocaleString()}
          detail={prDetail}
        />
        <MetricCard
          label="Merge rate"
          value={formatPercent(insights.pr.mergeRate)}
          detail={`${insights.pr.sessionsWithPrCount.toLocaleString()} sessions with PRs`}
        />
        <MetricCard
          label="Largest turn"
          value={`${formatTokens(insights.efficiency.largestMainTurnTokens)}`}
          detail="Tokens · main agent"
        />
        <MetricCard
          label="Avg tokens / turn"
          value={formatTokens(insights.efficiency.averageTokensPerMainTurn)}
          detail={`${insights.efficiency.mainAssistantTurnCount.toLocaleString()} assistant turns`}
        />
        <MetricCard
          label="Tool calls / turn"
          value={formatDecimal(insights.efficiency.toolCallsPerMainTurn)}
          detail="Across all tool calls"
        />
        <MetricCard
          label="Cache hit ratio"
          value={formatPercent(insights.efficiency.cacheReadRatio)}
          detail="Cached / total input tokens"
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-tight">
        {value}
      </div>
      {detail ? (
        <div className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground/70">
          {detail}
        </div>
      ) : null}
    </div>
  );
}
