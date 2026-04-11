import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { formatTokens } from "@open-harness/shared/lib/tool-state";
import { ContributionChart } from "@/components/contribution-chart";
import { getPublicUsageProfile } from "@/lib/db/public-usage-profile";
import { UsageInsightsSection } from "../settings/usage/usage-insights-section";

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
  const publicProfilePath = `/u/${profile.user.username}`;

  return {
    title: `${displayName} · Open Agents Wrapped`,
    description:
      `${displayName}'s Open Agents usage profile. ${modelDescription} ${profile.dateSelection.label}.`.trim(),
    openGraph: {
      title: `${displayName} · Open Agents Wrapped`,
      description: `${formatCompactNumber(profile.totals.totalTokens)} tokens · ${profile.dateSelection.label}`,
      images: [`${publicProfilePath}/og${dateQuery}`],
    },
    twitter: {
      card: "summary_large_image",
      title: `${displayName} · Open Agents Wrapped`,
      description: `${formatCompactNumber(profile.totals.totalTokens)} tokens · ${profile.dateSelection.label}`,
      images: [`${publicProfilePath}/og${dateQuery}`],
    },
  };
}

// ── Gray-scale dot classes: brightest first (top rank), darkest last ────────

const RANK_DOT_CLASSES = [
  "bg-neutral-100 dark:bg-neutral-200",
  "bg-neutral-300 dark:bg-neutral-400",
  "bg-neutral-400 dark:bg-neutral-500",
  "bg-neutral-500 dark:bg-neutral-600",
  "bg-neutral-600 dark:bg-neutral-700",
];

// ── Sub-components ─────────────────────────────────────────────────────────

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold font-mono tabular-nums">
          {value}
        </span>
      </div>
    </div>
  );
}

function RankedList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
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

function displayModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

// ── Main page ──────────────────────────────────────────────────────────────

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
  const publicProfilePath = `/u/${profile.user.username}`;
  const totalTokens = profile.totals.totalTokens;

  const presets = [
    { label: "All time", value: null },
    { label: "7d", value: "7d" },
    { label: "30d", value: "30d" },
    { label: "90d", value: "90d" },
  ];

  // Agent split ranked list
  const agentItems = [
    { label: "Main agent", value: formatTokens(profile.agentSplit.mainTokens) },
    {
      label: "Subagents",
      value: formatTokens(profile.agentSplit.subagentTokens),
    },
  ].filter((i) => i.value !== "0");

  // Top models ranked list (top 5)
  const modelItems = profile.topModels.slice(0, 5).map((m) => ({
    label: displayModelId(m.modelId),
    value: formatTokens(m.totalTokens),
  }));

  // Code churn ranked list
  const codeChurnItems = [
    {
      label: "Lines added",
      value: profile.insights.code.linesAdded.toLocaleString(),
    },
    {
      label: "Lines removed",
      value: profile.insights.code.linesRemoved.toLocaleString(),
    },
    {
      label: "Total changed",
      value: profile.insights.code.totalLinesChanged.toLocaleString(),
    },
  ];

  const hasUsage = profile.hasUsage;
  const hasRankedData =
    hasUsage || modelItems.length > 0 || codeChurnItems.length > 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:py-12">
        {/* Page header with date presets */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <nav className="flex gap-1">
            {presets.map((preset) => {
              const href = preset.value
                ? `${publicProfilePath}?date=${preset.value}`
                : publicProfilePath;
              const isActive = profile.dateSelection.value === preset.value;
              return (
                <Link
                  key={preset.label}
                  href={href}
                  prefetch={false}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                  }`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {profile.invalidDateError ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Invalid date filter — showing all-time data.
          </p>
        ) : null}

        {/* Two-column layout */}
        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:gap-10">
          {/* Left sidebar */}
          <div className="w-full shrink-0 lg:w-56">
            <div className="space-y-5">
              {/* Avatar + name */}
              <div className="flex items-center gap-3">
                {profile.user.avatarUrl ? (
                  <Image
                    src={profile.user.avatarUrl}
                    alt={profile.user.username}
                    width={56}
                    height={56}
                    className="shrink-0 rounded-full"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground">
                    {profile.user.username.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  {displayName !== profile.user.username ? (
                    <p className="truncate text-base font-semibold leading-tight">
                      {displayName}
                    </p>
                  ) : null}
                  <p className="truncate text-sm text-muted-foreground">
                    @{profile.user.username}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Usage · {profile.dateSelection.label}
                </h3>
                <div className="rounded-lg border border-border/50 bg-muted/10 px-4 py-1 divide-y divide-border/50">
                  <StatItem
                    label="Total tokens"
                    value={formatTokens(totalTokens)}
                  />
                  <StatItem
                    label="Messages"
                    value={profile.totals.messageCount.toLocaleString()}
                  />
                  <StatItem
                    label="Tool calls"
                    value={profile.totals.toolCallCount.toLocaleString()}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right content */}
          <div className="min-w-0 flex-1 space-y-8">
            {/* Activity grid */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Activity
                </h2>
              </div>
              <ContributionChart data={profile.dailyActivity} />
            </div>

            {/* Usage breakdown — ranked lists in a grid */}
            {hasRankedData && (
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
            <UsageInsightsSection insights={profile.insights} />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 flex items-center justify-between gap-4 border-t border-border/50 pt-6">
          <span className="font-mono text-xs text-muted-foreground">
            open-agents.dev{publicProfilePath}
            {profile.dateSelection.value
              ? `?date=${profile.dateSelection.value}`
              : ""}
          </span>
          <a
            href="https://open-agents.dev"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Agents ↗
          </a>
        </div>
      </div>
    </main>
  );
}
