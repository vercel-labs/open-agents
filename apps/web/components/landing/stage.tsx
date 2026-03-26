import type { ReactNode } from "react";

export type StageTone = "slate" | "ash" | "iron";

export function Stage({
  tone = "slate",
  children,
}: {
  readonly tone?: StageTone;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-none border border-(--l-border) p-3 sm:p-6 md:p-10"
      style={{
        backgroundColor: `var(--l-stage-${tone}-bg)`,
        backgroundImage: `var(--l-stage-${tone}-img)`,
        boxShadow: `var(--l-stage-${tone}-shadow)`,
      }}
    >
      <div className="grain pointer-events-none absolute inset-0 opacity-70" />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "var(--l-stage-overlay)" }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
