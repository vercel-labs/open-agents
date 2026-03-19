"use client";

import { SignInButton } from "@/components/auth/sign-in-button";
import { AppMockup } from "./hero-app-mockup";
import { ArrowIcon, GitHubIcon, TerminalIcon } from "./hero-icons";

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
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:gap-20">
          <div>
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
                  href="https://vercel.com"
                  className="text-[13px] text-black/35 transition-colors hover:text-black/60 dark:text-white/40 dark:hover:text-white/70"
                >
                  Vercel
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
