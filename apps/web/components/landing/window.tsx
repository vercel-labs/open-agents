import type { ReactNode } from "react";

export function Window({ children }: { readonly children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0A0A0A] shadow-[0_40px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/5">
      {children}
    </div>
  );
}
