"use client";

import { SessionStarter } from "@/components/session-starter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function SkeletonText({
  text,
  className,
  roundedClassName,
}: {
  text: string;
  className?: string;
  roundedClassName?: string;
}) {
  return (
    <span className={cn("relative inline-block", className)}>
      <span className="invisible">{text}</span>
      <span
        data-slot="skeleton"
        className={cn(
          "bg-accent animate-pulse absolute inset-0 rounded-md",
          roundedClassName,
        )}
      />
    </span>
  );
}

const NOOP = () => {};

export function TaskListSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <SkeletonText text="January 27" roundedClassName="rounded-sm" />
        </h3>
        <div className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                <SkeletonText
                  text="first slack conversation"
                  roundedClassName="rounded-sm"
                />
              </p>
              <p className="text-sm text-muted-foreground">
                <SkeletonText text="10:57 PM" roundedClassName="rounded-sm" />
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm font-mono">
                <SkeletonText
                  text="+0"
                  className="text-green-500"
                  roundedClassName="rounded-sm"
                />
                <SkeletonText
                  text="-0"
                  className="text-red-400"
                  roundedClassName="rounded-sm"
                />
              </div>
            </div>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                <SkeletonText
                  text="what can you do?"
                  roundedClassName="rounded-sm"
                />
              </p>
              <p className="text-sm text-muted-foreground">
                <SkeletonText text="10:54 PM" roundedClassName="rounded-sm" />
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm font-mono">
                <SkeletonText
                  text="+0"
                  className="text-green-500"
                  roundedClassName="rounded-sm"
                />
                <SkeletonText
                  text="-0"
                  className="text-red-400"
                  roundedClassName="rounded-sm"
                />
              </div>
            </div>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                <SkeletonText text="howdy" roundedClassName="rounded-sm" />
              </p>
              <p className="text-sm text-muted-foreground">
                <SkeletonText text="10:37 PM" roundedClassName="rounded-sm" />
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm font-mono">
                <SkeletonText
                  text="+0"
                  className="text-green-500"
                  roundedClassName="rounded-sm"
                />
                <SkeletonText
                  text="-0"
                  className="text-red-400"
                  roundedClassName="rounded-sm"
                />
              </div>
            </div>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                <SkeletonText
                  text="can you run npx skills add vercel/ai?"
                  roundedClassName="rounded-sm"
                />
              </p>
              <p className="text-sm text-muted-foreground">
                <SkeletonText
                  text="11:01 AM - agent-cli-playground"
                  roundedClassName="rounded-sm"
                />
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm font-mono">
                <SkeletonText
                  text="+0"
                  className="text-green-500"
                  roundedClassName="rounded-sm"
                />
                <SkeletonText
                  text="-0"
                  className="text-red-400"
                  roundedClassName="rounded-sm"
                />
              </div>
            </div>
          </button>
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <SkeletonText text="January 26" roundedClassName="rounded-sm" />
        </h3>
        <div className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                <SkeletonText text="hi" roundedClassName="rounded-sm" />
              </p>
              <p className="text-sm text-muted-foreground">
                <SkeletonText
                  text="10:06 PM - agent-cli-playground"
                  roundedClassName="rounded-sm"
                />
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm font-mono">
                <SkeletonText
                  text="+0"
                  className="text-green-500"
                  roundedClassName="rounded-sm"
                />
                <SkeletonText
                  text="-0"
                  className="text-red-400"
                  roundedClassName="rounded-sm"
                />
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
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
        <div className="flex h-9 w-9 items-center justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent" />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pt-16">
        <h1 className="mb-8 text-3xl font-light text-foreground">
          What should we ship next?
        </h1>

        <SessionStarter onSubmit={NOOP} isLoading />

        <div className="mt-8 w-full max-w-2xl">
          <Tabs defaultValue="sessions">
            <TabsList className="h-auto w-auto justify-start gap-8 bg-transparent p-0">
              <TabsTrigger
                value="sessions"
                className="relative h-auto rounded-none border-0 bg-transparent px-0 pb-3 pt-0 text-sm font-normal text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-normal data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent data-[state=active]:after:absolute data-[state=active]:after:-bottom-px data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-px data-[state=active]:after:bg-foreground"
              >
                Sessions
              </TabsTrigger>
              <TabsTrigger
                value="archive"
                className="relative h-auto rounded-none border-0 bg-transparent px-0 pb-3 pt-0 text-sm font-normal text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-normal data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent data-[state=active]:after:absolute data-[state=active]:after:-bottom-px data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-px data-[state=active]:after:bg-foreground"
              >
                Archive
              </TabsTrigger>
            </TabsList>
            <TabsContent value="sessions" className="mt-6">
              <TaskListSkeleton />
            </TabsContent>
            <TabsContent value="archive" className="mt-6">
              <TaskListSkeleton />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
