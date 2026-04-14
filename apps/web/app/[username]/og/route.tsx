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
        background: "#0a0a0a",
        color: "#ffffff",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background:
            "radial-gradient(ellipse 900px 500px at 15% 20%, rgba(255, 138, 61, 0.12), transparent 60%), radial-gradient(ellipse 700px 500px at 85% 80%, rgba(255, 255, 255, 0.04), transparent 60%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 28,
          borderRadius: 24,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 28,
          padding: "52px 56px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 22,
              flex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 4,
              }}
            >
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                <path
                  d="M4 17L10 11L4 5"
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 19H20"
                  stroke="rgba(255,255,255,0.5)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: "rgba(255, 255, 255, 0.5)",
                  letterSpacing: "-0.01em",
                }}
              >
                Open Agents
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  fontSize: 18,
                  textTransform: "uppercase",
                  letterSpacing: 1.6,
                  color: "rgba(255, 255, 255, 0.45)",
                  fontWeight: 600,
                }}
              >
                Wrapped
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  background: "rgba(255, 255, 255, 0.04)",
                  fontSize: 16,
                  color: "rgba(255, 255, 255, 0.55)",
                }}
              >
                {profile.dateSelection.label}
              </div>
            </div>

            <div
              style={{
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: "-0.04em",
                color: "#ffffff",
                maxWidth: 660,
              }}
            >
              {displayName}
            </div>

            <div style={{ fontSize: 28, color: "rgba(255, 255, 255, 0.45)" }}>
              @{profile.user.username}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 16,
              minWidth: 360,
            }}
          >
            <div
              style={{
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: 1.8,
                color: "rgba(255, 255, 255, 0.4)",
                fontWeight: 600,
              }}
            >
              Total tokens
            </div>
            <div
              style={{
                fontSize: 72,
                lineHeight: 1,
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              {formatCompactNumber(profile.totals.totalTokens)}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                width: "100%",
                marginTop: 4,
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

        <div style={{ display: "flex", gap: 14 }}>
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
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 14px",
        borderRadius: 999,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        background: "rgba(255, 255, 255, 0.04)",
        fontSize: 20,
      }}
    >
      <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.9)" }}>
        {value}
      </span>
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
        gap: 10,
        borderRadius: 16,
        padding: 20,
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      <div
        style={{
          fontSize: 14,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          color: "rgba(255, 255, 255, 0.4)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 26,
          lineHeight: 1.2,
          fontWeight: 600,
          color: "rgba(255, 255, 255, 0.95)",
          textWrap: "balance",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.3,
          color: "rgba(255, 255, 255, 0.4)",
        }}
      >
        {detail}
      </div>
    </div>
  );
}
