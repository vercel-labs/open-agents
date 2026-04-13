import { ImageResponse } from "next/og";

export const alt = "Open Agents — Spawn coding agents that run in the cloud";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

export default function OgImage() {
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
      {/* Subtle radial glow — top-left warm, bottom-right cool */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background:
            "radial-gradient(ellipse 900px 500px at 15% 20%, rgba(255, 138, 61, 0.12), transparent 60%), radial-gradient(ellipse 700px 500px at 85% 80%, rgba(255, 255, 255, 0.04), transparent 60%)",
        }}
      />

      {/* Noise-ish grain approximation with faint horizontal lines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, transparent 1px, transparent 3px)",
          opacity: 0.5,
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
          padding: "52px 56px",
        }}
      >
        {/* Top section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {/* Logo / icon + wordmark row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 40,
            }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <path
                d="M4 17L10 11L4 5"
                stroke="rgba(255,255,255,0.5)"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M12 19H20"
                stroke="rgba(255,255,255,0.5)"
                stroke-width="1.5"
                stroke-linecap="round"
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

          {/* Hero heading */}
          <div
            style={{
              fontSize: 82,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: "#ffffff",
            }}
          >
            Open Agents.
          </div>

          {/* Subtitle */}
          <div
            style={{
              marginTop: 24,
              fontSize: 28,
              lineHeight: 1.45,
              color: "rgba(255, 255, 255, 0.45)",
              maxWidth: 720,
            }}
          >
            Spawn coding agents that run infinitely in the cloud.
          </div>
        </div>

        {/* Bottom row — tech pills */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <TechPill label="AI SDK" />
          <TechPill label="Gateway" />
          <TechPill label="Sandbox" />
          <TechPill label="Workflow SDK" />

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
                color: "rgba(255, 255, 255, 0.3)",
                letterSpacing: "0.01em",
              }}
            >
              open-agents.dev
            </span>
          </div>
        </div>
      </div>
    </div>,
    { ...size },
  );
}

function TechPill({ label }: { label: string }) {
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
        color: "rgba(255, 255, 255, 0.55)",
      }}
    >
      {label}
    </div>
  );
}
