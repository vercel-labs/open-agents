"use client";

import { SignInButton } from "@/components/auth/sign-in-button";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export function SignedOutHero() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f8fafc] text-slate-900 dark:bg-[#0a0a0b] dark:text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(rgba(15,23,42,0.08)_1px,transparent_1px)] [background-size:24px_24px] dark:opacity-[0.4] dark:[background-image:radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(15,23,42,0.04)_2px,rgba(15,23,42,0.04)_4px)] dark:opacity-[0.02] dark:[background-image:repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.03)_2px,rgba(255,255,255,0.03)_4px)]" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-900/10 bg-white/70 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4 text-slate-700 dark:text-white/70"
            >
              <polyline points="4,17 10,11 4,5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <span className="text-lg font-medium tracking-tight text-slate-900 dark:text-white">
            Open Harness
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/vercel-labs/open-harness"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-slate-900/10 bg-white/60 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-900/20 hover:bg-white/90 hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-white/50 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.04] dark:hover:text-white/70"
          >
            <GitHubIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Open Source</span>
          </a>
          <SignInButton className="h-9 border-0 bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-white/90" />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <div className="mb-12 max-w-2xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/70 px-4 py-2 backdrop-blur dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/90 dark:bg-emerald-400/80" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500/70 dark:bg-emerald-400/60" />
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/50 dark:bg-emerald-400/40" />
            </div>
            <span className="text-xs text-slate-600 dark:text-white/40">
              Powered by AI SDK, Vercel AI Gateway, and Next.js
            </span>
          </div>

          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            Ship code faster with
            <br />
            <span className="bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent dark:from-white dark:via-white/90 dark:to-white/60">
              AI in the browser
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-slate-600 dark:text-white/50">
            Start a coding session in the browser, connect your repositories,
            and ship faster with Open Harness.
          </p>
        </div>

        <div className="w-full max-w-xl">
          <div className="overflow-hidden rounded-xl border border-slate-900/10 bg-white/80 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#111113]/80 dark:shadow-2xl dark:shadow-black/20">
            <div className="flex items-center gap-2 border-b border-slate-900/10 bg-slate-50/80 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <div className="h-3 w-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="ml-3 flex-1">
                <span className="font-mono text-xs text-slate-500 dark:text-white/30">
                  browser
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-900/10 bg-slate-50/70 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-5 w-5 text-slate-600 dark:text-white/60"
                >
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                </svg>
              </div>

              <h2 className="mb-2 text-lg font-medium tracking-tight text-slate-900 dark:text-white">
                Start on the web
              </h2>
              <p className="mb-5 text-sm leading-relaxed text-slate-600 dark:text-white/40">
                Run the coding agent from anywhere with no local setup required.
                Just sign in and start shipping.
              </p>

              <SignInButton className="h-10 w-full border-0 bg-slate-900 text-sm font-medium text-white transition-all hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-white/90" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
