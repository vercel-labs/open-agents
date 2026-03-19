export function AppMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-2xl shadow-black/8 dark:border-white/[0.06] dark:bg-[#111111] dark:shadow-black/30">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="h-2.5 w-2.5 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="h-2.5 w-2.5 rounded-full bg-black/10 dark:bg-white/10" />
          </div>
          <span className="ml-2 text-[11px] text-black/30 dark:text-white/25">
            open-harness / feat/auth-flow
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
          <span className="text-[11px] text-black/25 dark:text-white/20">
            running
          </span>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="hidden w-44 shrink-0 border-r border-black/[0.06] p-3 sm:block dark:border-white/[0.06]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-black/30 dark:text-white/25">
              Sessions
            </span>
            <div className="flex h-4 w-4 items-center justify-center rounded bg-black/[0.04] dark:bg-white/[0.06]">
              <span className="text-[10px] text-black/40 dark:text-white/30">
                +
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="rounded-md bg-black/[0.04] px-2.5 py-2 dark:bg-white/[0.06]">
              <div className="text-[11px] font-medium text-black/70 dark:text-white/70">
                Auth flow
              </div>
              <div className="mt-0.5 text-[10px] text-black/30 dark:text-white/25">
                3 min ago
              </div>
            </div>
            <div className="rounded-md px-2.5 py-2">
              <div className="text-[11px] text-black/40 dark:text-white/30">
                API refactor
              </div>
              <div className="mt-0.5 text-[10px] text-black/20 dark:text-white/15">
                2h ago
              </div>
            </div>
            <div className="rounded-md px-2.5 py-2">
              <div className="text-[11px] text-black/40 dark:text-white/30">
                Fix tests
              </div>
              <div className="mt-0.5 text-[10px] text-black/20 dark:text-white/15">
                1d ago
              </div>
            </div>
          </div>
        </div>

        {/* Main chat area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 p-4 sm:p-5">
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-black/[0.04] px-3.5 py-2.5 dark:bg-white/[0.06]">
                <p className="text-[12px] leading-relaxed text-black/70 dark:text-white/60">
                  Build the auth flow with GitHub OAuth
                </p>
              </div>
            </div>

            {/* Agent response */}
            <div className="space-y-2.5">
              {/* Tool call summary bar */}
              <div className="flex items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/[0.04]">
                <div className="flex items-center gap-1.5">
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3 w-3 text-black/30 dark:text-white/25"
                  >
                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11z" />
                    <path d="M8 4v4l3 1.5" />
                  </svg>
                  <span className="text-[10px] text-black/35 dark:text-white/30">
                    12 tool calls
                  </span>
                </div>
                <div className="mx-1 h-3 w-px bg-black/[0.06] dark:bg-white/[0.08]" />
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-black/35 dark:text-white/30">
                    3/4 todos
                  </span>
                  <div className="flex gap-0.5">
                    <div className="h-1 w-1 rounded-full bg-emerald-500/70" />
                    <div className="h-1 w-1 rounded-full bg-emerald-500/70" />
                    <div className="h-1 w-1 rounded-full bg-emerald-500/70" />
                    <div className="h-1 w-1 rounded-full bg-black/10 dark:bg-white/10" />
                  </div>
                </div>
                <div className="mx-1 h-3 w-px bg-black/[0.06] dark:bg-white/[0.08]" />
                <span className="text-[10px] text-black/25 dark:text-white/20">
                  42s
                </span>
              </div>

              {/* Agent text */}
              <div className="max-w-[90%]">
                <p className="text-[12px] leading-relaxed text-black/60 dark:text-white/50">
                  I&apos;ve set up the GitHub OAuth flow. Created the auth route
                  handler, callback endpoint, and session middleware. Running
                  the typecheck now…
                </p>
              </div>

              {/* Inline code file badge */}
              <FileBadges />
            </div>
          </div>

          {/* Input bar */}
          <div className="border-t border-black/[0.06] p-3 dark:border-white/[0.06]">
            <div className="flex items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.04]">
              <span className="flex-1 text-[11px] text-black/25 dark:text-white/20">
                Request changes or ask a question…
              </span>
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-black/80 dark:bg-white/80">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-2.5 w-2.5 text-white dark:text-black"
                >
                  <path d="M8 12V4M8 4l-3 3M8 4l3 3" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FILE_ICON_PATH =
  "M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z";

const FILE_NAMES = ["app/api/auth/route.ts", "lib/session.ts", "middleware.ts"];

function FileBadges() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FILE_NAMES.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[10px] text-black/40 dark:bg-white/[0.05] dark:text-white/30"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5">
            <path d={FILE_ICON_PATH} />
          </svg>
          {name}
        </span>
      ))}
    </div>
  );
}
