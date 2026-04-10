import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicUsageProfile } from "@/lib/db/public-usage-profile";

interface PublicUsagePageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{
    date?: string | string[];
  }>;
}

function getSingleSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function getBaseUrl(): Promise<string> {
  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    "open-agents.dev";
  const protocol = headerStore.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicUsagePageProps): Promise<Metadata> {
  const { username } = await params;
  const resolvedSearchParams = await searchParams;
  const date = getSingleSearchParam(resolvedSearchParams.date);
  const profile = await getPublicUsageProfile(username, date);

  if (!profile) {
    return {
      title: "Public profile",
      description: "Public Open Agents usage profile.",
    };
  }

  const displayName = profile.user.name?.trim() || profile.user.username;
  const topModel = profile.topModels[0]?.label;
  const modelDescription = topModel ? `Top model: ${topModel}.` : "";
  const dateQuery = profile.dateSelection.value
    ? `?date=${encodeURIComponent(profile.dateSelection.value)}`
    : "";
  const baseUrl = await getBaseUrl();

  return {
    title: `${displayName} · Open Agents Wrapped`,
    description:
      `${displayName}'s Open Agents usage profile. ${modelDescription} ${profile.dateSelection.label}.`.trim(),
    openGraph: {
      title: `${displayName} · Open Agents Wrapped`,
      description: `${formatCompactNumber(profile.totals.totalTokens)} tokens · ${profile.dateSelection.label}`,
      images: [`${baseUrl}/${profile.user.username}/og${dateQuery}`],
    },
    twitter: {
      card: "summary_large_image",
      title: `${displayName} · Open Agents Wrapped`,
      description: `${formatCompactNumber(profile.totals.totalTokens)} tokens · ${profile.dateSelection.label}`,
      images: [`${baseUrl}/${profile.user.username}/og${dateQuery}`],
    },
  };
}

export default async function PublicUsagePage({
  params,
  searchParams,
}: PublicUsagePageProps) {
  const { username } = await params;
  const resolvedSearchParams = await searchParams;
  const date = getSingleSearchParam(resolvedSearchParams.date);
  const profile = await getPublicUsageProfile(username, date);

  if (!profile) {
    notFound();
  }

  const displayName = profile.user.name?.trim() || profile.user.username;
  const topModel = profile.topModels[0] ?? null;
  const presets = [
    { label: "All time", value: null },
    { label: "7d", value: "7d" },
    { label: "30d", value: "30d" },
    { label: "90d", value: "90d" },
  ];

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-gradient-to-br from-background via-background to-muted/30 p-6 shadow-sm sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,119,198,0.18),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.12),transparent_28%)]" />
          <div className="relative flex flex-col gap-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                {profile.user.avatarUrl ? (
                  <Image
                    src={profile.user.avatarUrl}
                    alt={profile.user.username}
                    width={72}
                    height={72}
                    className="h-[72px] w-[72px] rounded-full border border-border/60 object-cover"
                  />
                ) : (
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-border/60 bg-muted/60 text-2xl font-semibold">
                    {profile.user.username.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    <span>Open Agents Wrapped</span>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 tracking-normal normal-case text-foreground/80">
                      {profile.dateSelection.label}
                    </span>
                  </div>
                  <div>
                    <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                      {displayName}
                    </h1>
                    <p className="text-sm text-muted-foreground sm:text-base">
                      @{profile.user.username}
                    </p>
                  </div>
                  <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                    Shareable usage stats from Open Agents — output volume, top
                    models, repo activity, and how this profile works across
                    main agents and subagents.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const href = preset.value
                    ? `/${profile.user.username}?date=${preset.value}`
                    : `/${profile.user.username}`;
                  const isActive = profile.dateSelection.value === preset.value;

                  return (
                    <Link
                      key={preset.label}
                      href={href}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/60 bg-background/70 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {preset.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {profile.invalidDateError ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                Couldn&apos;t parse that date filter, so this page is showing
                all-time usage instead.
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total tokens"
                value={formatCompactNumber(profile.totals.totalTokens)}
                detail={`${formatCompactNumber(profile.totals.outputTokens)} output`}
              />
              <StatCard
                label="Messages"
                value={profile.totals.messageCount.toLocaleString()}
                detail={`${profile.totals.toolCallCount.toLocaleString()} tool calls`}
              />
              <StatCard
                label="Top model"
                value={topModel?.label ?? "None yet"}
                detail={
                  topModel
                    ? `${formatCompactNumber(topModel.totalTokens)} tokens`
                    : "No tracked model usage"
                }
              />
              <StatCard
                label="Merge rate"
                value={formatPercent(profile.insights.pr.mergeRate)}
                detail={`${profile.insights.pr.mergedPrCount.toLocaleString()} merged PRs`}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <Panel
              title="Top models"
              description="Where most of the tokens went."
            >
              {profile.topModels.length > 0 ? (
                <div className="space-y-3">
                  {profile.topModels.slice(0, 5).map((model, index) => (
                    <div
                      key={model.modelId}
                      className="flex items-center gap-4 rounded-2xl border border-border/60 bg-background/80 px-4 py-3"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {model.label}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {model.provider}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold tabular-nums">
                          {formatCompactNumber(model.totalTokens)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {model.messageCount.toLocaleString()} msgs
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No model usage has been tracked yet." />
              )}
            </Panel>

            <Panel
              title="Repository activity"
              description="Where this profile has spent the most coding time."
            >
              {profile.topRepositories.length > 0 ? (
                <div className="space-y-3">
                  {profile.topRepositories.slice(0, 4).map((repo) => (
                    <a
                      key={`${repo.repoOwner}/${repo.repoName}`}
                      href={`https://github.com/${repo.repoOwner}/${repo.repoName}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/80 px-4 py-3 transition-colors hover:border-foreground/30"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {repo.repoOwner}/{repo.repoName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {repo.sessionCount.toLocaleString()} sessions ·{" "}
                          {repo.trackedPrCount.toLocaleString()} tracked PRs
                        </div>
                      </div>
                      <div className="font-mono text-sm text-muted-foreground tabular-nums">
                        {repo.totalLinesChanged.toLocaleString()} lines
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <EmptyState message="No repository activity has been tracked yet." />
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel
              title="Agent split"
              description="How work was split between the main agent and subagents."
            >
              <div className="space-y-4">
                <UsageBar
                  label="Main agent"
                  value={profile.agentSplit.mainTokens}
                  total={profile.totals.totalTokens}
                />
                <UsageBar
                  label="Subagents"
                  value={profile.agentSplit.subagentTokens}
                  total={profile.totals.totalTokens}
                />
              </div>
            </Panel>

            <Panel
              title="Code + efficiency"
              description="The high-level stats behind this profile."
            >
              <dl className="space-y-3 text-sm">
                <MetricRow
                  label="Lines changed"
                  value={profile.insights.code.totalLinesChanged.toLocaleString()}
                />
                <MetricRow
                  label="Lines added"
                  value={profile.insights.code.linesAdded.toLocaleString()}
                />
                <MetricRow
                  label="Largest turn"
                  value={formatCompactNumber(
                    profile.insights.efficiency.largestMainTurnTokens,
                  )}
                />
                <MetricRow
                  label="Avg tokens / turn"
                  value={formatCompactNumber(
                    profile.insights.efficiency.averageTokensPerMainTurn,
                  )}
                />
                <MetricRow
                  label="Tool calls / turn"
                  value={profile.insights.efficiency.toolCallsPerMainTurn.toFixed(
                    1,
                  )}
                />
                <MetricRow
                  label="Cache hit ratio"
                  value={formatPercent(
                    profile.insights.efficiency.cacheReadRatio,
                  )}
                />
              </dl>
            </Panel>

            <Panel
              title="Share this filter"
              description="The query param stays in the URL, so you can share a specific window."
            >
              <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 font-mono text-sm text-muted-foreground break-all">
                https://open-agents.dev/{profile.user.username}
                {profile.dateSelection.value
                  ? `?date=${profile.dateSelection.value}`
                  : ""}
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-border/60 bg-muted/20 p-6">
      <div className="mb-5 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function UsageBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percent = total > 0 ? Math.max((value / total) * 100, 0) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatCompactNumber(value)} · {Math.round(percent)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-[width]"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 px-4 py-6 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
