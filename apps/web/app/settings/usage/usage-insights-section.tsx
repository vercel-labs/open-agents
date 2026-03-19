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
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {detail ? (
        <div className="text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

export function UsageInsightsSection({ insights }: UsageInsightsSectionProps) {
  const lookbackWeeks = Math.round(insights.lookbackDays / 7);
  const prDetail = `${insights.pr.mergedPrCount} merged · ${insights.pr.openPrCount} open · ${insights.pr.closedPrCount} closed`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Insights</CardTitle>
        <CardDescription>
          Derived analytics from the last {lookbackWeeks} weeks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Code churn</h3>
            <div className="space-y-1 rounded-md border bg-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Lines added</span>
                <span className="font-medium">
                  {insights.code.linesAdded.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Lines removed</span>
                <span className="font-medium">
                  {insights.code.linesRemoved.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground">
                  Total lines changed
                </span>
                <span className="font-semibold">
                  {insights.code.totalLinesChanged.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Top repositories</h3>
            {insights.topRepositories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No repository activity in this period.
              </p>
            ) : (
              <div className="space-y-2">
                {insights.topRepositories.map((repo) => (
                  <div
                    key={`${repo.repoOwner}/${repo.repoName}`}
                    className="rounded-md border bg-card p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {repo.repoOwner}/{repo.repoName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {repo.sessionCount.toLocaleString()} sessions
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {repo.trackedPrCount.toLocaleString()} tracked PRs
                      </span>
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
