import type { ReactNode } from "react";

const tones = {
  slate: {
    backgroundColor: "#b8b8b8",
    backgroundImage:
      "radial-gradient(900px 420px at 26% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 62%), radial-gradient(720px 520px at 82% 72%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 58%), linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 55%)",
    shadow:
      "0 50px 90px rgba(0, 0, 0, 0.55), 0 2px 0 rgba(255, 255, 255, 0.06) inset, 0 -1px 0 rgba(0, 0, 0, 0.24) inset",
  },
  ash: {
    backgroundColor: "#a8a8a8",
    backgroundImage:
      "radial-gradient(900px 420px at 22% 20%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 62%), radial-gradient(820px 560px at 80% 74%, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 55%)",
    shadow:
      "0 50px 90px rgba(0, 0, 0, 0.55), 0 2px 0 rgba(255, 255, 255, 0.06) inset, 0 -1px 0 rgba(0, 0, 0, 0.24) inset",
  },
  iron: {
    backgroundColor: "#c0bdb8",
    backgroundImage:
      "radial-gradient(900px 420px at 24% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 62%), radial-gradient(780px 560px at 82% 72%, rgba(0,0,0,0.17) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 55%)",
    shadow:
      "0 50px 90px rgba(0, 0, 0, 0.55), 0 2px 0 rgba(255, 255, 255, 0.06) inset, 0 -1px 0 rgba(0, 0, 0, 0.24) inset",
  },
} as const;

export type StageTone = keyof typeof tones;

export function Stage({
  tone = "slate",
  children,
}: {
  readonly tone?: StageTone;
  readonly children: ReactNode;
}) {
  const styles = tones[tone];
  return (
    <div
      className="relative overflow-hidden rounded-none border border-white/[0.06] p-4 sm:p-6 md:p-10"
      style={{
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        boxShadow: styles.shadow,
      }}
    >
      <div className="grain pointer-events-none absolute inset-0 opacity-70" />
      <div className="absolute inset-0 bg-black/10" />
      <div className="relative">{children}</div>
    </div>
  );
}
