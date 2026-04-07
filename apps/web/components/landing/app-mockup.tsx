"use client";

import { useEffect, useRef, useState } from "react";

type FakeSession = {
  readonly title: string;
  readonly repo: string;
  readonly branch: string;
  readonly prompt: string;
  readonly summary: string;
  readonly toolCount: number;
  readonly todoTotal: number;
  readonly todoDone: number;
  readonly elapsed: string;
  readonly files: readonly string[];
};

const sessions: readonly FakeSession[] = [
  {
    title: "Auth flow",
    repo: "open-agents",
    branch: "feat/auth-flow",
    prompt: "Build the auth flow with GitHub OAuth",
    summary:
      "I\u2019ve set up the GitHub OAuth flow. Created the auth route handler, callback endpoint, and session middleware. Typecheck passes clean.",
    toolCount: 12,
    todoTotal: 4,
    todoDone: 3,
    elapsed: "42s",
    files: [
      "app/api/auth/route.ts",
      "app/api/auth/callback/route.ts",
      "middleware.ts",
    ],
  },
  {
    title: "API refactor",
    repo: "open-agents",
    branch: "feat/edge-api",
    prompt: "Refactor the chat API routes to use edge runtime",
    summary:
      "Migrated 2 routes to edge runtime. Removed Node-only APIs, added runtime exports, and verified with the full CI suite.",
    toolCount: 8,
    todoTotal: 3,
    todoDone: 3,
    elapsed: "1m 18s",
    files: ["app/api/chat/route.ts", "app/api/chat/[chatId]/stream/route.ts"],
  },
  {
    title: "Fix tests",
    repo: "open-agents",
    branch: "fix/test-suite",
    prompt: "Run the test suite and fix any failing tests",
    summary:
      "Found and fixed 4 failing tests across 3 files. All 47 tests pass now.",
    toolCount: 14,
    todoTotal: 4,
    todoDone: 4,
    elapsed: "56s",
    files: [
      "lib/chat-streaming-state.test.ts",
      "lib/swr.test.ts",
      "lib/db/sessions.test.ts",
    ],
  },
];

function useTypewriter(text: string, active: boolean, speed = 14) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setDisplayed(text);
      indexRef.current = text.length;
      return;
    }
    setDisplayed("");
    indexRef.current = 0;
    const id = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        clearInterval(id);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, active, speed]);

  return displayed;
}

function SummaryBar({ session: s }: { readonly session: FakeSession }) {
  return (
    <div className="flex items-center gap-1.5 overflow-hidden rounded-xl bg-(--l-panel-surface) px-2 py-1.5 text-[9px] sm:gap-2 sm:px-3 sm:py-2 sm:text-[10px]">
      <span className="shrink-0 text-(--l-panel-fg-3)">
        {s.toolCount} tools
      </span>
      <span className="h-3 w-px shrink-0 bg-(--l-panel-border)" />
      <span className="shrink-0 text-(--l-panel-fg-3)">
        {s.todoDone}/{s.todoTotal}
      </span>
      <div className="flex gap-0.5">
        {Array.from({ length: s.todoTotal }).map((_, i) => (
          <div
            key={i}
            className={`size-1 rounded-full ${i < s.todoDone ? "bg-(--l-panel-fg-2)" : "bg-(--l-panel-fg-5)"}`}
          />
        ))}
      </div>
      <span className="h-3 w-px bg-(--l-panel-border)" />
      <span className="text-(--l-panel-fg-4)">{s.elapsed}</span>
    </div>
  );
}

export function AppMockup() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [justSwitched, setJustSwitched] = useState(false);
  const active = sessions[activeIndex]!;
  const typedSummary = useTypewriter(active.summary, justSwitched, 14);

  const handleSwitch = (index: number) => {
    if (index === activeIndex) return;
    setActiveIndex(index);
    setJustSwitched(true);
  };

  useEffect(() => {
    if (!justSwitched) return;
    const timeout = setTimeout(
      () => setJustSwitched(false),
      active.summary.length * 14 + 200,
    );
    return () => clearTimeout(timeout);
  }, [justSwitched, active.summary.length]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-(--l-panel-border) bg-(--l-panel) ring-1 ring-(--l-panel-border)"
      style={{ boxShadow: "var(--l-window-shadow)" }}
    >
      <div className="flex items-center justify-between border-b border-(--l-panel-border) px-3 py-2 lg:px-4">
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 text-(--l-panel-fg-3)">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className="size-3.5"
              aria-hidden="true"
            >
              <rect
                x="1"
                y="1"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <rect
                x="1"
                y="10"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <rect
                x="10"
                y="1"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <rect
                x="10"
                y="10"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </div>
          <span className="font-medium text-(--l-panel-fg)">{active.repo}</span>
          <span className="hidden sm:inline text-(--l-panel-fg-4)">/</span>
          <span className="hidden sm:inline truncate text-(--l-panel-fg-2)">
            {active.branch}
          </span>
          <span className="hidden sm:inline text-(--l-panel-fg-4)">/</span>
          <span className="hidden sm:inline text-(--l-panel-fg-2)">
            {active.title}
          </span>
          <span className="size-2 rounded-full bg-(--l-panel-dot)" />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full bg-(--l-panel-surface) px-2 py-0.5 text-[10px] text-(--l-panel-fg-2) sm:inline">
            active
          </span>
        </div>
      </div>

      <div className="flex">
        <div className="hidden w-48 shrink-0 border-r border-(--l-panel-border) sm:block">
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-(--l-panel-fg-4)">
                Sessions
              </span>
              <div className="flex size-5 items-center justify-center rounded-md bg-(--l-panel-surface) text-[10px] text-(--l-panel-fg-3)">
                +
              </div>
            </div>
            <div className="space-y-0.5">
              {sessions.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => handleSwitch(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    i === activeIndex
                      ? "bg-(--l-panel-active)"
                      : "hover:bg-(--l-panel-surface)"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[11px] ${
                        i === activeIndex
                          ? "font-medium text-(--l-panel-fg)"
                          : "text-(--l-panel-fg-3)"
                      }`}
                    >
                      {s.title}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] ${
                      i === activeIndex
                        ? "text-(--l-panel-fg-3)"
                        : "text-(--l-panel-fg-4)"
                    }`}
                  >
                    {i === 0 ? "3m" : i === 1 ? "2h" : "1d"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-[280px] flex-1 overflow-hidden sm:min-h-[420px]">
            <div className="mx-auto max-w-2xl space-y-4 px-3 py-4 sm:space-y-5 sm:px-4 sm:py-6">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-3xl bg-(--l-panel-surface) px-3 py-2 sm:max-w-[80%] sm:px-4 sm:py-2.5">
                  <p className="text-[12px] leading-relaxed text-(--l-panel-fg)">
                    {active.prompt}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <SummaryBar session={active} />

                <div className="max-w-[90%]">
                  <p className="text-[12px] leading-[1.7] text-(--l-panel-fg-2)">
                    {typedSummary}
                    {justSwitched &&
                      typedSummary.length < active.summary.length && (
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-(--l-panel-fg-2)" />
                      )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {active.files.map((name) => (
                    <span
                      key={name}
                      className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-(--l-panel-surface) px-1.5 py-0.5 font-mono text-[9px] text-(--l-panel-fg-3) sm:gap-1.5 sm:px-2 sm:py-1 sm:text-[10px]"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="size-2.5 text-(--l-panel-fg-4)"
                        aria-hidden="true"
                      >
                        <path d="M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z" />
                      </svg>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="px-3 pb-2 pt-1 sm:px-4 sm:pb-3">
            <div className="mx-auto max-w-2xl">
              <div className="overflow-hidden rounded-2xl bg-(--l-panel-surface)">
                <div className="px-3 py-2 sm:px-4 sm:py-2.5">
                  <span className="text-[11px] text-(--l-panel-fg-4) sm:text-[12px]">
                    Request changes or ask a question...
                  </span>
                </div>
                <div className="flex items-center justify-between px-2.5 pb-1.5 sm:px-3 sm:pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-(--l-panel-fg-4)">
                      Claude Opus 4.6
                    </span>
                    <span className="text-[10px] text-(--l-panel-fg-5)">
                      1%
                    </span>
                  </div>
                  <div className="flex size-6 items-center justify-center rounded-full bg-(--l-btn-bg) sm:size-7">
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="size-3 text-(--l-btn-fg)"
                      aria-hidden="true"
                    >
                      <path d="M8 12V4M8 4l-3 3M8 4l3 3" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
