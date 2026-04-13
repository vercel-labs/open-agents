"use client";

import { SignInButton } from "@/components/auth/sign-in-button";
import { AppMockup } from "@/components/landing/app-mockup";
import { LandingBento } from "@/components/landing/bento";
import { LandingFeatures } from "@/components/landing/features";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { Stage } from "@/components/landing/stage";

export function SignedOutHero() {
  return (
    <div className="landing relative isolate min-h-screen bg-(--l-bg) text-(--l-fg) selection:bg-(--l-fg)/20">
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden md:block">
        <div className="mx-auto h-full max-w-[1320px] border-x border-x-(--l-border)" />
      </div>

      <div className="relative z-10">
        <LandingNav />

        <section className="relative overflow-hidden pb-0 pt-24 md:pb-0 md:pt-44">
          <div className="mx-auto max-w-[1320px] px-6">
            <div className="max-w-[740px]">
              <h1
                className="landing-fade-up text-4xl font-semibold leading-[1.03] tracking-tighter sm:text-5xl md:text-7xl"
                style={{ animationDelay: "30ms" }}
              >
                Open Agents.
              </h1>
              <p
                className="landing-fade-up mt-4 text-base leading-relaxed text-(--l-fg-2) sm:mt-6 sm:text-lg sm:text-(--l-fg-3)"
                style={{ animationDelay: "90ms" }}
              >
                Spawn coding agents that run infinitely in the cloud. Powered by
                AI SDK, Gateway, Sandbox, and Workflow SDK.
              </p>
            </div>

            <div
              className="landing-fade-up mt-6 flex items-center gap-4 sm:mt-8"
              style={{ animationDelay: "150ms" }}
            >
              <SignInButton className="h-10 rounded-md border-0 bg-(--l-btn-bg) px-5 text-[13px] font-medium text-(--l-btn-fg) transition-colors hover:bg-(--l-btn-hover)" />
              <a
                href="https://github.com/vercel-labs/open-harness"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] text-(--l-fg-4) transition-colors hover:text-(--l-fg-2)"
              >
                <GitHubIcon />
                Open Source
              </a>
            </div>
          </div>

          <div className="mx-auto mt-12 max-w-[1320px] px-4 sm:px-6 md:mt-20 md:px-0">
            <div
              className="landing-fade-up"
              style={{ animationDelay: "240ms" }}
            >
              <Stage tone="slate">
                <div className="mx-auto w-full max-w-[1160px]">
                  <AppMockup />
                </div>
              </Stage>
            </div>
          </div>
        </section>

        <LandingFeatures />
        <LandingBento />
        <LandingFooter />
      </div>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
