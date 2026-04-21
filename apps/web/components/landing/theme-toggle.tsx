"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "open-agents-theme";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  localStorage.setItem(STORAGE_KEY, theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const pick = useCallback((next: Theme) => {
    setTheme(next);
    applyTheme(next);
  }, []);

  const options: readonly {
    value: Theme;
    icon: "system" | "light" | "dark";
  }[] = [
    { value: "system", icon: "system" },
    { value: "light", icon: "light" },
    { value: "dark", icon: "dark" },
  ];

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-(--l-border) p-[3px]"
      style={{ backgroundColor: "var(--l-surface-2)" }}
    >
      {options.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => pick(option.value)}
            className="flex size-7 items-center justify-center rounded-full transition-all duration-200"
            style={{
              backgroundColor: active ? "var(--l-surface)" : "transparent",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              color: active ? "var(--l-fg)" : "var(--l-fg-2)",
            }}
            aria-label={`${option.value} theme`}
          >
            {option.icon === "system" && (
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <rect x="2" y="3" width="12" height="9" rx="1.5" />
                <path d="M5.5 15h5M8 12v3" />
              </svg>
            )}
            {option.icon === "light" && (
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="3" />
                <path d="M8 2v1M8 13v1M2 8h1M13 8h1M4.2 4.2l.7.7M11.1 11.1l.7.7M11.8 4.2l-.7.7M4.9 11.1l-.7.7" />
              </svg>
            )}
            {option.icon === "dark" && (
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <path d="M13.4 10.3A5.5 5.5 0 015.7 2.6a6 6 0 107.7 7.7z" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
