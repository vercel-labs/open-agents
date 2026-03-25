import type { ReactNode } from "react";

export function Window({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-(--l-panel-border) bg-(--l-panel) ring-1 ring-(--l-panel-border)"
      style={{ boxShadow: "var(--l-window-shadow)" }}
    >
      {children}
    </div>
  );
}
