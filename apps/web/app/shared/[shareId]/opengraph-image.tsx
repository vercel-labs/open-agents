import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getChatById } from "@/lib/db/sessions";
import {
  getSessionByIdCached,
  getShareByIdCached,
} from "@/lib/db/sessions-cache";

export const alt = "Shared Open Agents session";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;

  const share = await getShareByIdCached(shareId);
  if (!share) {
    return fallbackImage();
  }

  const chat = await getChatById(share.chatId);
  if (!chat) {
    return fallbackImage();
  }

  const session = await getSessionByIdCached(chat.sessionId);
  if (!session) {
    return fallbackImage();
  }

  const [owner] = await db
    .select({
      username: users.username,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!owner) {
    return fallbackImage();
  }

  const displayName = owner.name?.trim() || owner.username;
  const repoLabel =
    session.repoOwner && session.repoName
      ? `${session.repoOwner}/${session.repoName}`
      : null;

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
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          borderRadius: 24,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
        }}
      />

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
          padding: "52px 56px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 34,
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
                letterSpacing: "-0.01em",
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              Open Agents
            </span>
          </div>

          <div
            style={{
              fontSize: 52,
              lineHeight: 1.08,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "#fff",
              maxWidth: 980,
            }}
          >
            {chat.title || "Shared Chat"}
          </div>

          {repoLabel ? (
            <div
              style={{
                marginTop: 20,
                fontSize: 26,
                lineHeight: 1.3,
                color: "rgba(255, 255, 255, 0.5)",
                letterSpacing: "-0.01em",
              }}
            >
              {repoLabel}
            </div>
          ) : null}

          {session.branch ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 20,
                lineHeight: 1.3,
                color: "rgba(255, 255, 255, 0.45)",
              }}
            >
              Branch: {session.branch}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 20,
              color: "rgba(255, 255, 255, 0.55)",
              letterSpacing: "-0.01em",
            }}
          >
            Shared by {displayName}
          </span>
          <span
            style={{
              fontSize: 18,
              color: "rgba(255, 255, 255, 0.3)",
              letterSpacing: "0.01em",
            }}
          >
            open-agents.dev
          </span>
        </div>
      </div>
    </div>,
    { ...size },
  );
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
