"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const tools = [
  { name: "grep", detail: "auth patterns in src/" },
  { name: "read", detail: "lib/session.ts" },
  { name: "write", detail: "app/api/auth/route.ts" },
  { name: "write", detail: "app/api/auth/callback/route.ts" },
  { name: "edit", detail: "middleware.ts" },
  { name: "bash", detail: "bun run typecheck" },
] as const;

export function FeatureAgent() {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  const run = useCallback(() => {
    clear();
    setCount(0);
    pendingRef.current = setTimeout(() => {
      let i = 0;
      timerRef.current = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= tools.length) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          pendingRef.current = setTimeout(() => run(), 2000);
        }
      }, 550);
    }, 400);
  }, [clear]);

  useEffect(() => {
    run();
    return clear;
  }, [run, clear]);

  return (
    <div className="flex h-[280px] flex-col bg-(--l-code-bg)">
      <div className="flex-1 px-5 py-4">
        <div className="space-y-[3px]">
          {tools.map((tool, i) => (
            <div
              key={tool.detail}
              className="flex items-center gap-2.5 font-mono text-[12px] leading-[1.7] transition-opacity duration-300"
              style={{ opacity: i < count ? 0.65 : 0.18 }}
            >
              <span
                className="inline-flex size-1 shrink-0 rounded-full transition-colors duration-300"
                style={{
                  backgroundColor:
                    i === count - 1 && count <= tools.length
                      ? "var(--l-panel-fg)"
                      : i < count
                        ? "var(--l-panel-fg-3)"
                        : "var(--l-panel-fg-5)",
                }}
              />
              <span className="text-(--l-panel-fg-2)">{tool.name}</span>
              <span className="text-(--l-panel-fg-3)">{tool.detail}</span>
            </div>
          ))}
        </div>

        <div
          className="mt-5 text-[12px] leading-relaxed text-(--l-panel-fg-2) transition-opacity duration-500"
          style={{ opacity: count >= tools.length ? 1 : 0 }}
        >
          auth flow complete. 2 routes, middleware, callback. typecheck passes.
        </div>
      </div>
    </div>
  );
}
