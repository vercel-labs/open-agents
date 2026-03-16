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

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="4,17 10,11 4,5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

/* ─── Minimal app UI mockup ─── */
function AppMockup() {
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
                  I&apos;ve set up the GitHub OAuth flow. Created the auth
                  route handler, callback endpoint, and session middleware.
                  Running the typecheck now…
                </p>
              </div>

              {/* Inline code file badge */}
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[10px] text-black/40 dark:bg-white/[0.05] dark:text-white/30">
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-2.5 w-2.5"
                  >
                    <path d="M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z" />
                  </svg>
                  app/api/auth/route.ts
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[10px] text-black/40 dark:bg-white/[0.05] dark:text-white/30">
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-2.5 w-2.5"
                  >
                    <path d="M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z" />
                  </svg>
                  lib/session.ts
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-2 py-1 font-mono text-[10px] text-black/40 dark:bg-white/[0.05] dark:text-white/30">
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-2.5 w-2.5"
                  >
                    <path d="M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z" />
                  </svg>
                  middleware.ts
                </span>
              </div>
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

const features = [
  {
    num: "001",
    icon: (
      <div className="mb-5 flex gap-1">
        <div className="grid grid-cols-2 gap-0.5">
          <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
          <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
          <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
          <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
        </div>
      </div>
    ),
    title: "AI SDK",
    description:
      "Unified interface across models. Switch providers, stream responses, and call tools with a single API.",
    link: "Explore AI SDK",
  },
  {
    num: "002",
    icon: (
      <div className="mb-5 flex gap-0.5">
        <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
        <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
        <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
        <div className="h-2.5 w-2.5 rounded-[2px] border border-black/15 dark:border-white/20" />
      </div>
    ),
    title: "AI Gateway",
    description:
      "Route requests across providers with built-in fallbacks, rate limiting, and observability.",
    link: "Read Gateway docs",
  },
  {
    num: "003",
    icon: (
      <div className="mb-5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-5 w-5 text-black/25 dark:text-white/40"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
      </div>
    ),
    title: "Sandbox",
    description:
      "Secure, isolated environments for every agent session. Full filesystem, network, and runtime access.",
    link: "Read Sandbox docs",
  },
  {
    num: "004",
    icon: (
      <div className="mb-5 flex gap-1">
        <div className="flex flex-col gap-0.5">
          <div className="flex gap-0.5">
            <div className="h-2 w-2 rounded-[2px] border border-black/15 dark:border-white/20" />
            <div className="h-2 w-2 rounded-[2px] border border-black/15 dark:border-white/20" />
          </div>
          <div className="h-2 w-2 rounded-[2px] border border-black/15 dark:border-white/20" />
        </div>
      </div>
    ),
    title: "Workflow DevKit",
    description:
      "Durable, resumable agent workflows that survive restarts and coordinate multi-step operations.",
    link: "Read Workflow docs",
  },
];

export function SignedOutHero() {
  return (
    <div className="min-h-screen bg-[#fafafa] text-black selection:bg-black/10 dark:bg-[#0a0a0a] dark:text-white dark:selection:bg-white/20">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2.5">
          <TerminalIcon className="h-4 w-4 text-black/40 dark:text-white/60" />
          <span className="text-[15px] font-medium tracking-tight text-black/90 dark:text-white/90">
            Open Harness
          </span>
        </div>
        <nav className="flex items-center gap-5">
          <a
            href="https://github.com/vercel-labs/open-harness"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-black/35 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          >
            Docs
          </a>
          <a
            href="https://github.com/vercel-labs/open-harness"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-black/35 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          >
            Story
          </a>
          <a
            href="https://github.com/vercel-labs/open-harness"
            target="_blank"
            rel="noopener noreferrer"
            className="text-black/35 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          >
            <GitHubIcon className="h-4 w-4" />
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="px-6 pb-8 pt-12 sm:px-10 sm:pt-20">
        <div className="max-w-3xl">
          <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[1.05] tracking-tight text-black dark:text-white">
            Open cloud agents.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-black/45 dark:text-white/45">
            Spawn coding agents that run infinitely in the cloud. Powered by AI
            SDK, Gateway, Sandbox, and Workflow DevKit.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <SignInButton className="h-10 rounded-md border-0 bg-black px-5 text-[13px] font-medium text-white transition-colors hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/90" />
            <a
              href="https://github.com/vercel-labs/open-harness"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
            >
              <GitHubIcon className="h-3.5 w-3.5" />
              Open Source
            </a>
          </div>
        </div>
      </section>

      {/* App mockup */}
      <section className="px-6 pb-20 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <AppMockup />
        </div>
      </section>

      {/* Middle section */}
      <section className="border-t border-black/[0.06] px-6 py-20 sm:px-10 sm:py-28 dark:border-white/[0.06]">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-[1.1] tracking-tight text-black dark:text-white">
              Agents that ship
              <br />
              real code.
            </h2>
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-[15px] leading-relaxed text-black/45 dark:text-white/45">
              Each agent gets a full sandbox environment with filesystem,
              network, and runtime access. Connect your repos, describe what to
              build, and let the agent work autonomously until it&apos;s done.
            </p>
            <div className="mt-6">
              <SignInButton className="inline-flex h-10 items-center gap-2 rounded-md border border-black/[0.1] bg-transparent px-5 text-[13px] font-medium text-black/70 transition-colors hover:border-black/20 hover:bg-black/[0.03] hover:text-black dark:border-white/[0.1] dark:text-white/80 dark:hover:border-white/20 dark:hover:bg-white/[0.03] dark:hover:text-white" />
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="border-t border-black/[0.06] px-6 py-20 sm:px-10 sm:py-28 dark:border-white/[0.06]">
        <div className="mb-16 grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-[1.1] tracking-tight text-black dark:text-white">
              Infrastructure
              <br />
              that ships.
            </h2>
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-[15px] leading-relaxed text-black/45 dark:text-white/45">
              Built on production-grade primitives from the Vercel ecosystem. No
              synthetic demos — real infrastructure for real agents.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.04] sm:grid-cols-2 lg:grid-cols-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
          {features.map((feature) => (
            <div
              key={feature.num}
              className="flex flex-col justify-between bg-[#fafafa] p-6 sm:p-7 dark:bg-[#0a0a0a]"
            >
              <div>
                <span className="mb-5 block text-[11px] tabular-nums text-black/20 dark:text-white/20">
                  {feature.num}
                </span>
                {feature.icon}
                <h3 className="mb-2.5 text-[17px] font-medium tracking-tight text-black/85 dark:text-white/90">
                  {feature.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-black/40 dark:text-white/35">
                  {feature.description}
                </p>
              </div>
              <div className="mt-6">
                <span className="group flex items-center gap-1 text-[13px] font-medium text-[#b07030] transition-colors hover:text-[#c8885a] dark:text-[#c8885a] dark:hover:text-[#dba070]">
                  {feature.link}
                  <ArrowIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] px-6 py-14 sm:px-10 sm:py-20 dark:border-white/[0.06]">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4 lg:gap-20">
          <div className="col-span-2 sm:col-span-1">
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-black/25 dark:text-white/25">
              Open Harness
            </h4>
            <p className="mt-3 text-[13px] leading-relaxed text-black/30 dark:text-white/30">
              Open cloud agents for
              <br />
              shipping code.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-black/25 dark:text-white/25">
              Product
            </h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Documentation
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  AI SDK
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Sandbox
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Workflow DevKit
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-black/25 dark:text-white/25">
              Resources
            </h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness/releases"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Releases
                </a>
              </li>
              <li>
                <a
                  href="https://www.npmjs.com/package/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  NPM
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-black/25 dark:text-white/25">
              Company
            </h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://vercel.com"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Vercel
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vercel-labs/open-harness"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Story
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-black/[0.04] pt-6 dark:border-white/[0.04]">
          <span className="text-[12px] text-black/20 dark:text-white/20">
            © {new Date().getFullYear()} Vercel
          </span>
        </div>
      </footer>
    </div>
  );
}
