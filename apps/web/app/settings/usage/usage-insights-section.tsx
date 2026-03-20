import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UsageInsights } from "@/lib/usage/types";

interface UsageInsightsSectionProps {
  insights: UsageInsights;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function formatDecimal(value: number): string {
  return value.toFixed(1);
}

function formatLookbackLabel(lookbackDays: number): string {
  if (lookbackDays <= 1) {
    return "1 day";
  }

  if (lookbackDays < 14) {
    return `${lookbackDays.toLocaleString()} days`;
  }

  const lookbackWeeks = Math.round(lookbackDays / 7);
  return `${lookbackWeeks.toLocaleString()} weeks`;
}

function InsightMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/50 bg-muted/20 p-4">
      <div className="text-[11px] font-medium leading-snug text-muted-foreground sm:text-xs">
        {label}
      </div>
      <div className="mt-1 break-words text-2xl font-bold tracking-tight sm:text-3xl">
        {value}
      </div>
      {detail ? (
        <div className="text-xs leading-snug text-muted-foreground/70">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function ChurnBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  if (total === 0) return null;
  const addedPct = (added / total) * 100;
  const removedPct = (removed / total) * 100;

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div
        className="bg-emerald-500 transition-all dark:bg-emerald-400"
        style={{ width: `${addedPct}%` }}
      />
      <div
        className="bg-red-400 transition-all dark:bg-red-400"
        style={{ width: `${removedPct}%` }}
      />
    </div>
  );
}

function RepoBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground/20 transition-all"
        style={{ width: `${Math.max(pct, 2)}%` }}
      />
    </div>
  );
}

export function UsageInsightsSection({ insights }: UsageInsightsSectionProps) {
  const lookbackLabel = formatLookbackLabel(insights.lookbackDays);
  const prDetail = `${insights.pr.mergedPrCount} merged · ${insights.pr.openPrCount} open · ${insights.pr.closedPrCount} closed`;
  const maxRepoLines = Math.max(
    ...insights.topRepositories.map((r) => r.totalLinesChanged),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Insights</CardTitle>
        <CardDescription>
          Derived analytics from the last {lookbackLabel}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 sm:space-y-8">
        {/* Primary metrics row */}
        <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
          <InsightMetric
            label="Tracked PRs"
            value={insights.pr.trackedPrCount.toLocaleString()}
            detail={prDetail}
          />
          <InsightMetric
            label="Merge rate"
            value={formatPercent(insights.pr.mergeRate)}
            detail={`${insights.pr.sessionsWithPrCount.toLocaleString()} sessions with PRs`}
          />
          <InsightMetric
            label="Largest assistant turn"
            value={`${formatTokens(insights.efficiency.largestMainTurnTokens)} tokens`}
            detail="Main agent only"
          />
          <InsightMetric
            label="Avg tokens / assistant turn"
            value={formatTokens(insights.efficiency.averageTokensPerMainTurn)}
            detail={`${insights.efficiency.mainAssistantTurnCount.toLocaleString()} assistant turns`}
          />
          <InsightMetric
            label="Tool calls / assistant turn"
            value={formatDecimal(insights.efficiency.toolCallsPerMainTurn)}
            detail="Across all recorded tool calls"
          />
          <InsightMetric
            label="Cache read ratio"
            value={formatPercent(insights.efficiency.cacheReadRatio)}
            detail="Cached input tokens / input tokens"
          />
        </div>

        <div className="h-px bg-border" />

        {/* Code churn + Top repos */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Code churn */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Code churn</h3>

            <div className="space-y-3">
              <ChurnBar
                added={insights.code.linesAdded}
                removed={insights.code.linesRemoved}
              />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    <span className="text-xs text-muted-foreground">Added</span>
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {insights.code.linesAdded.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                    <span className="text-xs text-muted-foreground">
                      Removed
                    </span>
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {insights.code.linesRemoved.toLocaleString()}
                  </div>
                </div>
                <div className="col-span-2 rounded-xl border border-border/50 bg-muted/20 p-3 sm:col-span-1">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {insights.code.totalLinesChanged.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Top repositories */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">
              Top repositories
            </h3>
            {insights.topRepositories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No repository activity in this period.
              </p>
            ) : (
              <div className="space-y-3">
                {insights.topRepositories.map((repo) => (
                  <div
                    key={`${repo.repoOwner}/${repo.repoName}`}
                    className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-3"
                  >
                    <div className="flex flex-col gap-1 min-[480px]:flex-row min-[480px]:items-baseline min-[480px]:justify-between">
                      <span className="min-w-0 break-words text-sm font-medium leading-snug min-[480px]:truncate">
                        {repo.repoOwner}/{repo.repoName}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground min-[480px]:text-right">
                        {repo.sessionCount.toLocaleString()} sessions
                      </span>
                    </div>
                    <RepoBar
                      value={repo.totalLinesChanged}
                      max={maxRepoLines}
                    />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{repo.trackedPrCount.toLocaleString()} PRs</span>
                      <span>
                        {repo.totalLinesChanged.toLocaleString()} lines changed
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
