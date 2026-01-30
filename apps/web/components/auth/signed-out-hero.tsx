"use client";

import { Cloud, Monitor, Terminal } from "lucide-react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { InstallCommandCard } from "@/components/install-command-card";

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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Ambient gradient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-[20%] -top-[30%] h-[600px] w-[600px] rounded-full bg-gradient-to-br from-blue-500/[0.07] via-violet-500/[0.05] to-transparent blur-3xl" />
        <div className="absolute -bottom-[20%] -right-[10%] h-[500px] w-[500px] rounded-full bg-gradient-to-tl from-emerald-500/[0.05] via-cyan-500/[0.03] to-transparent blur-3xl" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                            linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <header className="relative z-10 flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-gradient-to-b from-muted/50 to-muted/30">
            <Terminal className="h-4 w-4 text-foreground/80" />
          </div>
          <span className="text-lg font-medium tracking-tight">
            Open Harness
          </span>
        </div>
        <a
          href="https://github.com/vercel-labs/open-harness"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground"
        >
          <GitHubIcon className="h-4 w-4" />
          <span>Open Source</span>
        </a>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16">
        {/* Hero section */}
        <div className="mb-14 max-w-2xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/40 bg-muted/30 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm">
            Powered by AI SDK 6, Vercel AI Gateway, Vercel Sandbox, Turborepo,
            Next.js and more
          </div>

          <h1 className="text-balance bg-gradient-to-b from-foreground via-foreground to-foreground/70 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
            Ship code faster with
            <br />
            <span className="bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text">
              AI that runs anywhere
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
            A cloud platform and CLI that share the same AI workflows. Start in
            the browser, continue locally, or work entirely from your terminal.
          </p>
        </div>

        {/* Cards section */}
        <div className="w-full max-w-3xl">
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Web card */}
            <div className="group relative rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 p-6 transition-all duration-300 hover:border-border hover:shadow-lg hover:shadow-black/5">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-muted/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <div className="relative">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-b from-background to-muted/30">
                  <Cloud className="h-5 w-5 text-muted-foreground" />
                </div>

                <h2 className="mb-2 text-lg font-medium tracking-tight text-foreground">
                  Start on the web
                </h2>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                  Run the coding agent from anywhere - no local setup required.
                  Just sign in and start shipping.
                </p>

                <SignInButton />
              </div>
            </div>

            {/* CLI card */}
            <div className="group relative rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 p-6 transition-all duration-300 hover:border-border hover:shadow-lg hover:shadow-black/5">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-muted/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <div className="relative">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-b from-background to-muted/30">
                  <Monitor className="h-5 w-5 text-muted-foreground" />
                </div>

                <h2 className="mb-2 text-lg font-medium tracking-tight text-foreground">
                  Run it locally
                </h2>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                  Install the CLI to run the same AI workflows directly on your
                  machine.
                </p>

                <InstallCommandCard variant="inline" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
