import { ImageResponse } from "next/og";
import {
  getPublicUsageProfile,
  displayModelId,
} from "@/lib/db/public-usage-profile";

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

  const displayName = profile.user.name?.trim() || profile.user.username;
  const topModel = profile.topModels[0];
  const topModelLabel = topModel ? displayModelId(topModel.modelId) : null;

  // ── Activity grid ────────────────────────────────────────────────────────
  const activityData = profile.dailyActivity;
  const maxTokens = Math.max(
    ...activityData.map(
      (d) => d.inputTokens + d.outputTokens + d.messageCount * 100,
    ),
    1,
  );

  const today = new Date();
  const gridWeeks = 38;
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - gridWeeks * 7 + 1);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const activityMap = new Map<string, number>();
  for (const d of activityData) {
    activityMap.set(
      d.date,
      d.inputTokens + d.outputTokens + d.messageCount * 100,
    );
  }

  const weeks: number[][] = [];
  const cursor = new Date(startDate);
  for (let w = 0; w < gridWeeks; w++) {
    const week: number[] = [];
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      week.push(activityMap.get(key) ?? 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const cellSize = 13;
  const cellGap = 3;

  function getColor(value: number): string {
    if (value === 0) return "rgba(255, 255, 255, 0.03)";
    const ratio = value / maxTokens;
    if (ratio < 0.15) return "rgba(255, 255, 255, 0.07)";
    if (ratio < 0.35) return "rgba(255, 255, 255, 0.14)";
    if (ratio < 0.6) return "rgba(255, 255, 255, 0.24)";
    if (ratio < 0.8) return "rgba(255, 255, 255, 0.38)";
    return "rgba(255, 255, 255, 0.55)";
  }

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
      {/* Radial glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background:
            "radial-gradient(ellipse 900px 500px at 15% 20%, rgba(255, 138, 61, 0.12), transparent 60%), radial-gradient(ellipse 700px 500px at 85% 80%, rgba(255, 255, 255, 0.04), transparent 60%)",
        }}
      />

      {/* Border frame */}
      <div
        style={{
          position: "absolute",
          inset: 28,
          borderRadius: 24,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
        }}
      />

      {/* Activity grid — decorative bg, top-right */}
      <div
        style={{
          position: "absolute",
          top: 56,
          right: 56,
          display: "flex",
          gap: cellGap,
        }}
      >
        {weeks.map((week, wi) => (
          <div
            key={wi}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: cellGap,
            }}
          >
            {week.map((val, di) => (
              <div
                key={di}
                style={{
                  width: cellSize,
                  height: cellSize,
                  borderRadius: 3,
                  background: getColor(val),
                  display: "flex",
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Fade gradients over grid */}
      <div
        style={{
          position: "absolute",
          top: 28,
          right: 28,
          width: 700,
          height: 180,
          display: "flex",
          background: "linear-gradient(to right, #0a0a0a 5%, transparent 50%)",
          borderRadius: "24px 24px 0 0",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 160,
          right: 28,
          width: 700,
          height: 100,
          display: "flex",
          background: "linear-gradient(to top, #0a0a0a, transparent)",
        }}
      />

      {/* Content — using fixed positioning for reliable layout */}
      {/* Top-left: Open Agents branding */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 84,
          display: "flex",
          alignItems: "center",
          gap: 12,
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

      {/* Center-left: Avatar + name */}
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 84,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        {profile.user.avatarUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            alt=""
            src={profile.user.avatarUrl}
            width={72}
            height={72}
            style={{ borderRadius: "50%" }}
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 600,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            {profile.user.username.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 42,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              color: "#ffffff",
            }}
          >
            {displayName}
          </span>
          {displayName !== profile.user.username && (
            <span
              style={{
                fontSize: 22,
                color: "rgba(255, 255, 255, 0.4)",
              }}
            >
              @{profile.user.username}
            </span>
          )}
        </div>
      </div>

      {/* Hero token number */}
      <div
        style={{
          position: "absolute",
          bottom: 136,
          left: 84,
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
        }}
      >
        <span
          style={{
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: "#ffffff",
          }}
        >
          {formatCompactNumber(profile.totals.totalTokens)}
        </span>
        <span
          style={{
            fontSize: 28,
            lineHeight: 1,
            color: "rgba(255, 255, 255, 0.3)",
            fontWeight: 500,
            paddingBottom: 8,
          }}
        >
          tokens
        </span>
      </div>

      {/* Bottom row: pills + domain */}
      <div
        style={{
          position: "absolute",
          bottom: 72,
          left: 84,
          right: 84,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {topModelLabel && <Pill label="Top model" value={topModelLabel} />}
        <Pill
          label="Messages"
          value={profile.totals.messageCount.toLocaleString()}
        />
        <Pill
          label="Tool calls"
          value={profile.totals.toolCallCount.toLocaleString()}
        />

        {/* Spacer + domain */}
        <div
          style={{
            display: "flex",
            flex: 1,
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: 18,
              color: "rgba(255, 255, 255, 0.2)",
              letterSpacing: "0.01em",
            }}
          >
            open-agents.dev
          </span>
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        borderRadius: 999,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        background: "rgba(255, 255, 255, 0.04)",
        fontSize: 16,
        gap: 8,
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>
        {value}
      </span>
    </div>
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
