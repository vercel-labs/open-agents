"use client";

import { History } from "lucide-react";
import { SessionStarter } from "@/components/session-starter";

const NOOP = () => {};

export function HomeSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2 sm:justify-self-start">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <span className="text-lg font-semibold">Open Harness</span>
        </div>
        <div className="hidden sm:block" />
        <div className="flex items-center gap-2 sm:justify-self-end">
          <button
            type="button"
            disabled
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground opacity-50"
          >
            <History className="h-4 w-4" />
            <span>Sessions</span>
          </button>
          <div className="flex size-9 items-center justify-center">
            <div className="h-8 w-8 rounded-full bg-accent" />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pt-8 sm:pt-16">
        <h1 className="mb-8 text-3xl font-light text-foreground">
          What should we ship next?
        </h1>

        <SessionStarter onSubmit={NOOP} isLoading />
      </main>
    </div>
  );
}
