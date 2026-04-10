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
  const maxModelTokens = topModel?.totalTokens ?? 1;
  const presets = [
    { label: "All time", value: null },
    { label: "7d", value: "7d" },
    { label: "30d", value: "30d" },
    { label: "90d", value: "90d" },
  ];

  const mainPercent =
    profile.totals.totalTokens > 0
      ? Math.round(
          (profile.agentSplit.mainTokens / profile.totals.totalTokens) * 100,
        )
      : 0;
  const subPercent = 100 - mainPercent;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#09090b] text-white selection:bg-amber-500/30">
      {/* Atmospheric gradient orbs */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-[-30%] left-[-15%] h-[700px] w-[700px] rounded-full bg-amber-500/[0.04] blur-[160px]" />
        <div className="absolute right-[-10%] bottom-[-25%] h-[600px] w-[600px] rounded-full bg-sky-500/[0.03] blur-[140px]" />
      </div>

      {/* Grain texture */}
      <div className="grain pointer-events-none fixed inset-0 z-[1]" />

      <div className="relative z-10 mx-auto max-w-[960px] px-6 py-14 sm:py-20">
        {/* ── Top bar: brand + date filter ── */}
        <div
          className="wrapped-enter flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ animationDelay: "0ms" }}
        >
          <span className="text-[11px] font-medium tracking-[0.25em] uppercase text-white/25">
            Open Agents Wrapped
          </span>

          <nav className="flex gap-1.5">
            {presets.map((preset) => {
              const href = preset.value
                ? `/${profile.user.username}?date=${preset.value}`
                : `/${profile.user.username}`;
              const isActive = profile.dateSelection.value === preset.value;

              return (
                <Link
                  key={preset.label}
                  href={href}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 ease-out active:scale-[0.97] ${
                    isActive
                      ? "bg-white text-[#09090b] shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                      : "text-white/40 hover:bg-white/[0.06] hover:text-white/70"
                  }`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* ── Invalid date warning ── */}
        {profile.invalidDateError ? (
          <div
            className="wrapped-enter mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 text-[13px] text-amber-200/80"
            style={{ animationDelay: "60ms" }}
          >
            Couldn&apos;t parse that date filter — showing all-time usage
            instead.
          </div>
        ) : null}

        {/* ── Profile hero ── */}
        <div
          className="wrapped-enter mt-14 flex items-center gap-5 sm:mt-16"
          style={{ animationDelay: "80ms" }}
        >
          {profile.user.avatarUrl ? (
            <Image
              src={profile.user.avatarUrl}
              alt={profile.user.username}
              width={72}
              height={72}
              className="h-[72px] w-[72px] rounded-full ring-1 ring-white/[0.08] ring-offset-2 ring-offset-[#09090b]"
            />
          ) : (
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-white/[0.06] text-2xl font-semibold text-white/50 ring-1 ring-white/[0.08]">
              {profile.user.username.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[clamp(1.75rem,5vw,3rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
              {displayName}
            </h1>
            <p className="mt-1.5 text-[15px] text-white/35">
              @{profile.user.username}
            </p>
          </div>
        </div>

        {/* ── Hero stats ── */}
        <div className="mt-14 grid grid-cols-2 gap-x-10 gap-y-8 sm:mt-16 sm:grid-cols-4 sm:gap-8">
          <StatBlock
            label="Total tokens"
            value={formatCompactNumber(profile.totals.totalTokens)}
            detail={`${formatCompactNumber(profile.totals.outputTokens)} output`}
            delay={160}
          />
          <StatBlock
            label="Messages"
            value={profile.totals.messageCount.toLocaleString()}
            detail={`${profile.totals.toolCallCount.toLocaleString()} tool calls`}
            delay={210}
          />
          <StatBlock
            label="Top model"
            value={topModel?.label ?? "—"}
            detail={
              topModel
                ? `${formatCompactNumber(topModel.totalTokens)} tokens`
                : "No tracked model usage"
            }
            delay={260}
            isHighlight
          />
          <StatBlock
            label="Merge rate"
            value={formatPercent(profile.insights.pr.mergeRate)}
            detail={`${profile.insights.pr.mergedPrCount.toLocaleString()} merged PRs`}
            delay={310}
          />
        </div>

        {/* ── Divider ── */}
        <div
          className="wrapped-enter mt-14 h-px bg-white/[0.06] sm:mt-16"
          style={{ animationDelay: "380ms" }}
        />

        {/* ── Content columns ── */}
        <div className="mt-12 grid gap-14 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
          {/* Left column */}
          <div className="space-y-14">
            {/* Top Models */}
            <section
              className="wrapped-enter"
              style={{ animationDelay: "420ms" }}
            >
              <SectionHeader
                title="Top models"
                subtitle="Where the tokens went"
              />
              {profile.topModels.length > 0 ? (
                <div className="mt-6 space-y-2">
                  {profile.topModels.slice(0, 5).map((model, index) => {
                    const barPercent =
                      (model.totalTokens / maxModelTokens) * 100;
                    return (
                      <ModelRow
                        key={model.modelId}
                        rank={index + 1}
                        name={model.label}
                        provider={model.provider}
                        tokens={formatCompactNumber(model.totalTokens)}
                        messages={model.messageCount.toLocaleString()}
                        barPercent={barPercent}
                        delay={460 + index * 50}
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No model usage tracked yet." />
              )}
            </section>

            {/* Repository activity */}
            <section
              className="wrapped-enter"
              style={{ animationDelay: "500ms" }}
            >
              <SectionHeader
                title="Repositories"
                subtitle="Where the code was written"
              />
              {profile.topRepositories.length > 0 ? (
                <div className="mt-6 space-y-2">
                  {profile.topRepositories.slice(0, 4).map((repo) => (
                    <a
                      key={`${repo.repoOwner}/${repo.repoName}`}
                      href={`https://github.com/${repo.repoOwner}/${repo.repoName}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group -mx-3 flex items-center justify-between gap-4 rounded-xl px-3 py-3.5 transition-colors duration-150 ease-out hover:bg-white/[0.04]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-medium text-white/90 transition-colors duration-150 group-hover:text-white">
                          {repo.repoOwner}
                          <span className="text-white/25">/</span>
                          {repo.repoName}
                        </div>
                        <div className="mt-0.5 text-[13px] text-white/30">
                          {repo.sessionCount.toLocaleString()} sessions ·{" "}
                          {repo.trackedPrCount.toLocaleString()} tracked PRs
                        </div>
                      </div>
                      <div className="shrink-0 font-mono text-[13px] text-white/40 tabular-nums">
                        {repo.totalLinesChanged.toLocaleString()} lines
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <EmptyState message="No repository activity tracked yet." />
              )}
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-14">
            {/* Agent split */}
            <section
              className="wrapped-enter"
              style={{ animationDelay: "460ms" }}
            >
              <SectionHeader
                title="Agent split"
                subtitle="Main agent vs. subagents"
              />
              <div className="mt-6">
                {/* Split bar */}
                <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
                  {profile.totals.totalTokens > 0 ? (
                    <>
                      <div
                        className="wrapped-bar-fill rounded-l-full bg-gradient-to-r from-amber-400/50 to-amber-500/30"
                        style={{
                          width: `${mainPercent}%`,
                          animationDelay: "700ms",
                        }}
                      />
                      <div
                        className="wrapped-bar-fill bg-white/[0.10]"
                        style={{
                          width: `${subPercent}%`,
                          animationDelay: "750ms",
                        }}
                      />
                    </>
                  ) : (
                    <div className="h-full w-full bg-white/[0.04]" />
                  )}
                </div>
                {/* Labels */}
                <div className="mt-3.5 flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400/60" />
                    <span className="text-white/50">Main agent</span>
                    <span className="font-mono text-white/30 tabular-nums">
                      {formatCompactNumber(profile.agentSplit.mainTokens)} ·{" "}
                      {mainPercent}%
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-white/20" />
                    <span className="text-white/50">Subagents</span>
                    <span className="font-mono text-white/30 tabular-nums">
                      {formatCompactNumber(profile.agentSplit.subagentTokens)} ·{" "}
                      {subPercent}%
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Code + efficiency */}
            <section
              className="wrapped-enter"
              style={{ animationDelay: "520ms" }}
            >
              <SectionHeader
                title="Code + efficiency"
                subtitle="The numbers behind the output"
              />
              <div className="mt-6 space-y-0">
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
              </div>
            </section>

            {/* Share URL */}
            <section
              className="wrapped-enter"
              style={{ animationDelay: "580ms" }}
            >
              <SectionHeader title="Share" subtitle="Link to this exact view" />
              <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 font-mono text-[13px] text-white/35 break-all">
                open-agents.dev/{profile.user.username}
                {profile.dateSelection.value
                  ? `?date=${profile.dateSelection.value}`
                  : ""}
              </div>
            </section>
          </div>
        </div>

        {/* ── Footer ── */}
        <div
          className="wrapped-enter mt-20 border-t border-white/[0.06] pt-6"
          style={{ animationDelay: "650ms" }}
        >
          <p className="text-[12px] text-white/20">
            Shareable usage stats from{" "}
            <a
              href="https://open-agents.dev"
              className="text-white/30 underline decoration-white/10 underline-offset-2 transition-colors duration-150 hover:text-white/50"
            >
              Open Agents
            </a>{" "}
            — output volume, top models, repo activity, and agent behavior.
          </p>
        </div>
      </div>
    </main>
  );
}

/* ─────────────────────────── Local components ─────────────────────────── */

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h2 className="text-[15px] font-medium tracking-[-0.01em] text-white/90">
        {title}
      </h2>
      <p className="mt-0.5 text-[13px] text-white/30">{subtitle}</p>
    </div>
  );
}

function StatBlock({
  label,
  value,
  detail,
  delay,
  isHighlight,
}: {
  label: string;
  value: string;
  detail: string;
  delay: number;
  isHighlight?: boolean;
}) {
  return (
    <div className="wrapped-enter" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[11px] font-medium tracking-[0.2em] uppercase text-white/25">
        {label}
      </div>
      <div
        className={`mt-2.5 font-mono text-[clamp(1.5rem,4vw,2.25rem)] leading-none font-semibold tracking-[-0.02em] tabular-nums ${
          isHighlight
            ? "bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent"
            : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[13px] text-white/30">{detail}</div>
    </div>
  );
}

function ModelRow({
  rank,
  name,
  provider,
  tokens,
  messages,
  barPercent,
  delay,
}: {
  rank: number;
  name: string;
  provider: string;
  tokens: string;
  messages: string;
  barPercent: number;
  delay: number;
}) {
  return (
    <div className="group -mx-3 rounded-xl px-3 py-3 transition-colors duration-150 ease-out hover:bg-white/[0.03]">
      <div className="flex items-center gap-3.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-medium tabular-nums ${
            rank === 1
              ? "bg-amber-500/15 text-amber-300/90"
              : "bg-white/[0.05] text-white/25"
          }`}
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-white/85">
            {name}
          </div>
          <div className="text-[12px] text-white/25">{provider}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[13px] font-medium text-white/70 tabular-nums">
            {tokens}
          </div>
          <div className="text-[12px] text-white/25">{messages} msgs</div>
        </div>
      </div>
      {/* Relative usage bar */}
      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="wrapped-bar-fill h-full rounded-full bg-gradient-to-r from-white/20 to-white/[0.06]"
          style={{
            width: `${Math.max(barPercent, 2)}%`,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-dotted border-white/[0.06] py-2.5">
      <span className="text-[13px] text-white/40">{label}</span>
      <span className="min-w-0 flex-1" />
      <span className="font-mono text-[13px] font-medium text-white/80 tabular-nums">
        {value}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[13px] text-white/25">
      {message}
    </div>
  );
}
