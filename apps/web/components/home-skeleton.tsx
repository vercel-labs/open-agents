"use client";

import { History } from "lucide-react";
import { SessionStarter } from "@/components/session-starter";

const NOOP = () => {};

interface HomeSkeletonProps {
  lastRepo?: { owner: string; repo: string } | null;
}

export function HomeSkeleton({ lastRepo = null }: HomeSkeletonProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2 sm:justify-self-start">
          <span className="text-lg font-semibold">Open Agents</span>
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

        <SessionStarter onSubmit={NOOP} isLoading lastRepo={lastRepo} />
      </main>
    </div>
  );
}
