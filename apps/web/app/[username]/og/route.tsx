import { ImageResponse } from "next/og";
import { getPublicUsageProfile } from "@/lib/db/public-usage-profile";

interface OgRouteContext {
  params: Promise<{ username: string }>;
}

export async function GET(request: Request, context: OgRouteContext) {
  const { username } = await context.params;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const profile = await getPublicUsageProfile(username, date);

  if (!profile) {
    return new Response("Not found", { status: 404 });
  }

  const topModel = profile.topModels[0]?.label ?? "No tracked model yet";
  const displayName = profile.user.name?.trim() || profile.user.username;

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #060816 0%, #0f172a 38%, #111827 100%)",
        color: "#f8fafc",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at top right, rgba(99, 102, 241, 0.45), transparent 28%), radial-gradient(circle at bottom left, rgba(56, 189, 248, 0.32), transparent 24%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 32,
          borderRadius: 40,
          border: "1px solid rgba(148, 163, 184, 0.18)",
          background: "rgba(15, 23, 42, 0.58)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 44,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 32,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 22,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: "rgba(226, 232, 240, 0.72)",
              }}
            >
              <span>Open Agents Wrapped</span>
              <span
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                  borderRadius: 999,
                  padding: "8px 14px",
                  textTransform: "none",
                  letterSpacing: 0,
                  fontSize: 18,
                  color: "#f8fafc",
                }}
              >
                {profile.dateSelection.label}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1 }}>
                {displayName}
              </div>
              <div style={{ fontSize: 30, color: "rgba(226, 232, 240, 0.72)" }}>
                @{profile.user.username}
              </div>
            </div>
            <div
              style={{
                maxWidth: 760,
                fontSize: 28,
                lineHeight: 1.35,
                color: "rgba(226, 232, 240, 0.82)",
              }}
            >
              Shareable output, usage, and model stats from Open Agents.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  textTransform: "uppercase",
                  letterSpacing: 2,
                  color: "rgba(226, 232, 240, 0.6)",
                }}
              >
                Total tokens
              </div>
              <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1 }}>
                {formatCompactNumber(profile.totals.totalTokens)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                width: 320,
              }}
            >
              <Pill
                label="Messages"
                value={profile.totals.messageCount.toLocaleString()}
              />
              <Pill
                label="Tool calls"
                value={profile.totals.toolCallCount.toLocaleString()}
              />
              <Pill
                label="Merge rate"
                value={`${Math.round(profile.insights.pr.mergeRate * 100)}%`}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 20,
          }}
        >
          <FeatureCard
            title="Top model"
            value={topModel}
            detail={
              profile.topModels[0]
                ? `${formatCompactNumber(profile.topModels[0].totalTokens)} tokens`
                : "No tracked model usage"
            }
          />
          <FeatureCard
            title="Main agent"
            value={formatCompactNumber(profile.agentSplit.mainTokens)}
            detail="Primary agent token volume"
          />
          <FeatureCard
            title="Subagents"
            value={formatCompactNumber(profile.agentSplit.subagentTokens)}
            detail="Explorer + executor work"
          />
          <FeatureCard
            title="Top repo"
            value={
              profile.topRepositories[0]
                ? `${profile.topRepositories[0].repoOwner}/${profile.topRepositories[0].repoName}`
                : "No repo yet"
            }
            detail={
              profile.topRepositories[0]
                ? `${profile.topRepositories[0].totalLinesChanged.toLocaleString()} lines changed`
                : "Waiting for tracked sessions"
            }
          />
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
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

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 18px",
        borderRadius: 20,
        background: "rgba(15, 23, 42, 0.8)",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        fontSize: 22,
      }}
    >
      <span style={{ color: "rgba(226, 232, 240, 0.72)" }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function FeatureCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderRadius: 28,
        padding: 24,
        background: "rgba(15, 23, 42, 0.82)",
        border: "1px solid rgba(148, 163, 184, 0.18)",
      }}
    >
      <div
        style={{
          fontSize: 18,
          textTransform: "uppercase",
          letterSpacing: 2,
          color: "rgba(226, 232, 240, 0.6)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 700,
          lineHeight: 1.15,
          textWrap: "balance",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 18,
          lineHeight: 1.35,
          color: "rgba(226, 232, 240, 0.72)",
        }}
      >
        {detail}
      </div>
    </div>
  );
}
