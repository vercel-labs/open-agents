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

function fmt(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "open-agents.dev";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicUsagePageProps): Promise<Metadata> {
  const { username } = await params;
  const rsp = await searchParams;
  const date = getSingleSearchParam(rsp.date);
  const profile = await getPublicUsageProfile(username, date);

  if (!profile) {
    return {
      title: "Public profile",
      description: "Public Open Agents usage profile.",
    };
  }

  const displayName = profile.user.name?.trim() || profile.user.username;
  const topModel = profile.topModels[0]?.label;
  const modelDesc = topModel ? `Top model: ${topModel}.` : "";
  const dateQ = profile.dateSelection.value
    ? `?date=${encodeURIComponent(profile.dateSelection.value)}`
    : "";
  const baseUrl = await getBaseUrl();

  return {
    title: `${displayName} · Open Agents Wrapped`,
    description:
      `${displayName}'s Open Agents usage profile. ${modelDesc} ${profile.dateSelection.label}.`.trim(),
    openGraph: {
      title: `${displayName} · Open Agents Wrapped`,
      description: `${fmt(profile.totals.totalTokens)} tokens · ${profile.dateSelection.label}`,
      images: [`${baseUrl}/${profile.user.username}/og${dateQ}`],
    },
    twitter: {
      card: "summary_large_image",
      title: `${displayName} · Open Agents Wrapped`,
      description: `${fmt(profile.totals.totalTokens)} tokens · ${profile.dateSelection.label}`,
      images: [`${baseUrl}/${profile.user.username}/og${dateQ}`],
    },
  };
}

export default async function PublicUsagePage({
  params,
  searchParams,
}: PublicUsagePageProps) {
  const { username } = await params;
  const rsp = await searchParams;
  const date = getSingleSearchParam(rsp.date);
  const profile = await getPublicUsageProfile(username, date);

  if (!profile) {
    notFound();
  }

  const displayName = profile.user.name?.trim() || profile.user.username;
  const topModels = profile.topModels.slice(0, 5);
  const maxTokens = topModels[0]?.totalTokens ?? 1;

  const presets = [
    { label: "All time", value: null },
    { label: "7d", value: "7d" },
    { label: "30d", value: "30d" },
    { label: "90d", value: "90d" },
  ];

  const totalRepos = profile.topRepositories.length;
  const topRepos = profile.topRepositories.slice(0, 3);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#060608] text-[#e8e8e8] selection:bg-white/20">
      {/* Background atmosphere */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-[10%] left-[50%] h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-white/[0.015] blur-[200px]" />
      </div>
      <div className="grain pointer-events-none fixed inset-0 z-[1]" />

      <div className="relative z-10 mx-auto max-w-[700px] px-6 pb-20 pt-12 sm:pt-16">
        {/* ── Header ── */}
        <header
          className="wrapped-enter flex items-center justify-between"
          style={{ animationDelay: "0ms" }}
        >
          <span className="text-[11px] font-medium tracking-[0.3em] uppercase text-white/20">
            Wrapped
          </span>
          <nav className="flex gap-0.5">
            {presets.map((preset) => {
              const href = preset.value
                ? `/${profile.user.username}?date=${preset.value}`
                : `/${profile.user.username}`;
              const isActive = profile.dateSelection.value === preset.value;
              return (
                <Link
                  key={preset.label}
                  href={href}
                  className={`rounded-full px-3 py-1 text-[12px] transition-colors duration-150 ease-out active:scale-[0.97] ${
                    isActive
                      ? "bg-white/[0.1] text-white"
                      : "text-white/25 hover:text-white/50"
                  }`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {profile.invalidDateError ? (
          <p
            className="wrapped-enter mt-4 text-[13px] text-white/30"
            style={{ animationDelay: "40ms" }}
          >
            Invalid date filter — showing all-time data.
          </p>
        ) : null}

        {/* ── Identity ── */}
        <div
          className="wrapped-enter mt-12 flex items-center gap-3.5"
          style={{ animationDelay: "60ms" }}
        >
          {profile.user.avatarUrl ? (
            <Image
              src={profile.user.avatarUrl}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-full opacity-80 grayscale"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-sm font-medium text-white/40">
              {profile.user.username.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="text-[14px] text-white/40">
            {displayName !== profile.user.username ? (
              <>
                <span className="text-white/60">{displayName}</span>
                {" · "}
              </>
            ) : null}
            @{profile.user.username}
          </div>
        </div>

        {/* ── The Number ── */}
        <section
          className="wrapped-enter mt-16 sm:mt-20"
          style={{ animationDelay: "140ms" }}
        >
          <div className="text-[clamp(5rem,18vw,9rem)] leading-[0.9] font-semibold tracking-[-0.04em] text-white">
            {fmt(profile.totals.totalTokens)}
          </div>
          <div className="mt-3 text-[13px] tracking-[0.2em] uppercase text-white/25">
            tokens consumed
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-white/30">
            <span>
              <span className="font-mono text-white/50 tabular-nums">
                {fmt(profile.totals.outputTokens)}
              </span>{" "}
              output
            </span>
            <span>
              <span className="font-mono text-white/50 tabular-nums">
                {profile.totals.messageCount.toLocaleString()}
              </span>{" "}
              messages
            </span>
            <span>
              <span className="font-mono text-white/50 tabular-nums">
                {profile.totals.toolCallCount.toLocaleString()}
              </span>{" "}
              tool calls
            </span>
          </div>
        </section>

        {/* ── Divider ── */}
        <div
          className="wrapped-enter mt-16 h-px bg-white/[0.06] sm:mt-20"
          style={{ animationDelay: "260ms" }}
        />

        {/* ── Models ── */}
        <section
          className="wrapped-enter mt-12 sm:mt-14"
          style={{ animationDelay: "300ms" }}
        >
          {topModels.length > 0 ? (
            <>
              <p className="text-[13px] text-white/25">
                {topModels.length === 1 ? "Model of choice" : "#1 model"}
              </p>
              <h2 className="mt-1 text-[clamp(1.5rem,5vw,2.5rem)] leading-[1.1] font-semibold tracking-[-0.03em] text-white">
                {topModels[0].label}
              </h2>

              <div className="mt-10 space-y-5">
                {topModels.map((model, i) => {
                  const pct = (model.totalTokens / maxTokens) * 100;
                  return (
                    <div key={model.modelId}>
                      <div className="flex items-baseline justify-between gap-4">
                        <div className="flex items-baseline gap-2.5 min-w-0">
                          <span className="font-mono text-[12px] text-white/15 tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="truncate text-[15px] text-white/70">
                            {model.label}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-[13px] text-white/35 tabular-nums">
                          {fmt(model.totalTokens)}
                        </span>
                      </div>
                      <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-white/[0.04]">
                        <div
                          className="wrapped-bar-fill h-full rounded-full"
                          style={{
                            width: `${Math.max(pct, 1.5)}%`,
                            animationDelay: `${380 + i * 70}ms`,
                            background:
                              i === 0
                                ? "linear-gradient(90deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 100%)"
                                : "linear-gradient(90deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-[14px] text-white/20">
              No model usage tracked yet.
            </p>
          )}
        </section>

        {/* ── Divider ── */}
        <div
          className="wrapped-enter mt-16 h-px bg-white/[0.06] sm:mt-20"
          style={{ animationDelay: "540ms" }}
        />

        {/* ── Impact ── */}
        <section
          className="wrapped-enter mt-12 sm:mt-14"
          style={{ animationDelay: "580ms" }}
        >
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[clamp(1.75rem,6vw,3rem)] leading-none font-semibold tracking-[-0.03em] text-white font-mono tabular-nums">
                {profile.insights.pr.mergedPrCount.toLocaleString()}
              </div>
              <div className="mt-2 text-[12px] tracking-[0.15em] uppercase text-white/20">
                PRs merged
              </div>
            </div>
            <div>
              <div className="text-[clamp(1.75rem,6vw,3rem)] leading-none font-semibold tracking-[-0.03em] text-white font-mono tabular-nums">
                {fmt(profile.insights.code.totalLinesChanged)}
              </div>
              <div className="mt-2 text-[12px] tracking-[0.15em] uppercase text-white/20">
                Lines changed
              </div>
            </div>
            <div>
              <div className="text-[clamp(1.75rem,6vw,3rem)] leading-none font-semibold tracking-[-0.03em] text-white font-mono tabular-nums">
                {totalRepos.toLocaleString()}
              </div>
              <div className="mt-2 text-[12px] tracking-[0.15em] uppercase text-white/20">
                Repositories
              </div>
            </div>
          </div>

          {/* Top repos — compact linked list */}
          {topRepos.length > 0 ? (
            <div className="mt-8 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
              {topRepos.map((repo, i) => (
                <span key={`${repo.repoOwner}/${repo.repoName}`}>
                  <a
                    href={`https://github.com/${repo.repoOwner}/${repo.repoName}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/35 underline decoration-white/10 underline-offset-2 transition-colors duration-150 hover:text-white/60 hover:decoration-white/25"
                  >
                    {repo.repoOwner}/{repo.repoName}
                  </a>
                  {i < topRepos.length - 1 ? (
                    <span className="ml-1.5 text-white/10">·</span>
                  ) : null}
                </span>
              ))}
              {totalRepos > 3 ? (
                <span className="text-white/15">+{totalRepos - 3} more</span>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ── Footer ── */}
        <div
          className="wrapped-enter mt-24 flex items-center justify-between gap-4 border-t border-white/[0.04] pt-6 sm:mt-32"
          style={{ animationDelay: "660ms" }}
        >
          <span className="font-mono text-[12px] text-white/15">
            open-agents.dev/{profile.user.username}
            {profile.dateSelection.value
              ? `?date=${profile.dateSelection.value}`
              : ""}
          </span>
          <a
            href="https://open-agents.dev"
            className="text-[12px] text-white/15 transition-colors duration-150 hover:text-white/30"
          >
            Open Agents ↗
          </a>
        </div>
      </div>
    </main>
  );
}
