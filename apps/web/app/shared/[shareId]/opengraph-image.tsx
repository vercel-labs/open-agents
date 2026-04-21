import { ImageResponse } from "next/og";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMessages, users, workflowRuns } from "@/lib/db/schema";
import { getChatById } from "@/lib/db/sessions";
import {
  getSessionByIdCached,
  getShareByIdCached,
} from "@/lib/db/sessions-cache";

export const alt = "Shared Open Agents session";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60)
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function displayModelName(modelId: string): string {
  if (modelId.startsWith("variant:")) return "Custom variant";
  const slashIndex = modelId.indexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

export default async function Image({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;

  const share = await getShareByIdCached(shareId);
  if (!share) return fallbackImage();

  const chat = await getChatById(share.chatId);
  if (!chat) return fallbackImage();

  const session = await getSessionByIdCached(chat.sessionId);
  if (!session) return fallbackImage();

  // Parallel fetch: owner, duration from workflow_runs, message count
  const [ownerResult, durationResult, messageStats] = await Promise.all([
    db
      .select({
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
    db
      .select({
        totalMs: sql<number>`coalesce(sum(${workflowRuns.totalDurationMs}), 0)`,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.chatId, chat.id)),
    db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chat.id)),
  ]);

  const owner = ownerResult[0];
  if (!owner) return fallbackImage();

  const displayName = owner.name?.trim() || owner.username;
  const totalDurationMs = durationResult[0]?.totalMs ?? 0;
  const messageCount = messageStats[0]?.count ?? 0;

  const repoLabel =
    session.repoOwner && session.repoName
      ? `${session.repoOwner}/${session.repoName}`
      : null;
  const modelLabel = chat.modelId ? displayModelName(chat.modelId) : null;

  // Build metadata pills
  const pills: { icon: string; label: string }[] = [];
  if (modelLabel) pills.push({ icon: "model", label: modelLabel });
  if (totalDurationMs > 0)
    pills.push({ icon: "clock", label: formatDuration(totalDurationMs) });
  if (messageCount > 0)
    pills.push({ icon: "messages", label: `${messageCount} messages` });
  if (session.prNumber) {
    const prLabel = `PR #${session.prNumber}`;
    pills.push({
      icon: "pr",
      label: session.prStatus === "merged" ? `${prLabel} merged` : prLabel,
    });
  }

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "#0a0a0a",
        color: "#ffffff",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Gradient background */}
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
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          borderRadius: 24,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 56px",
        }}
      >
        {/* Top section */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Logo row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 32,
            }}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
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
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "rgba(255, 255, 255, 0.45)",
              }}
            >
              Open Agents
            </span>
          </div>

          {/* Chat title */}
          <div
            style={{
              fontSize: chat.title && chat.title.length > 60 ? 40 : 50,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: "-0.035em",
              color: "#fff",
              maxWidth: 980,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {chat.title || "Shared Chat"}
          </div>

          {/* Repo label */}
          {repoLabel ? (
            <div
              style={{
                marginTop: 18,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                style={{
                  fontSize: 22,
                  color: "rgba(255, 255, 255, 0.45)",
                  letterSpacing: "-0.01em",
                }}
              >
                {repoLabel}
              </span>
            </div>
          ) : null}
        </div>

        {/* Bottom section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Left: Avatar + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {owner.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={owner.avatarUrl}
                alt=""
                width={44}
                height={44}
                style={{
                  borderRadius: "50%",
                  border: "2px solid rgba(255, 255, 255, 0.12)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "rgba(255, 255, 255, 0.1)",
                  border: "2px solid rgba(255, 255, 255, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  fontWeight: 600,
                  color: "rgba(255, 255, 255, 0.6)",
                }}
              >
                {(displayName ?? "?")[0]?.toUpperCase()}
              </div>
            )}
            <span
              style={{
                fontSize: 20,
                color: "rgba(255, 255, 255, 0.55)",
                letterSpacing: "-0.01em",
                fontWeight: 500,
              }}
            >
              {displayName}
            </span>
          </div>

          {/* Right: Metadata pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {pills.map((pill) => (
              <MetadataPill
                key={pill.label}
                icon={pill.icon}
                label={pill.label}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    { ...size },
  );
}

function MetadataPill({ icon, label }: { icon: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 14px",
        borderRadius: 999,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        background: "rgba(255, 255, 255, 0.04)",
        fontSize: 15,
        color: "rgba(255, 255, 255, 0.55)",
      }}
    >
      <PillIcon type={icon} />
      {label}
    </div>
  );
}

function PillIcon({ type }: { type: string }) {
  const stroke = "rgba(255,255,255,0.5)";
  const sw = "1.5";
  switch (type) {
    case "model":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L2 7l10 5 10-5-10-5z"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <path
            d="M2 17l10 5 10-5"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2 12l10 5 10-5"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "clock":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke={stroke} strokeWidth={sw} />
          <path
            d="M12 6v6l4 2"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </svg>
      );
    case "messages":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "pr":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="18" cy="18" r="3" stroke={stroke} strokeWidth={sw} />
          <circle cx="6" cy="6" r="3" stroke={stroke} strokeWidth={sw} />
          <path
            d="M13 6h3a2 2 0 0 1 2 2v7"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <path
            d="M6 9v12"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

function fallbackImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "rgba(255, 255, 255, 0.55)",
        fontSize: 42,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      Shared Open Agents session
    </div>,
    { ...size },
  );
}
