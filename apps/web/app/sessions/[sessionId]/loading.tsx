"use client";

import {
  EllipsisVertical,
  ExternalLink,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSessionLayout } from "./session-layout-context";

export default function Loading() {
  const { session } = useSessionLayout();

  const hasRepo = Boolean(session.repoName);
  const hasExistingPr = Boolean(session.prNumber);

  return (
    <>
      {/* Header */}
      <header className="border-b border-border px-3 py-2 lg:px-4 lg:py-3">
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 lg:gap-4">
            <SidebarTrigger className="shrink-0" />
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {session.repoName ? (
                <>
                  {session.cloneUrl ? (
                    <Link
                      href={`https://github.com/${session.repoOwner}/${session.repoName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate font-medium text-foreground hover:underline"
                    >
                      {session.repoName}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-foreground">
                      {session.repoName}
                    </span>
                  )}
                  {session.branch && (
                    <>
                      <span className="hidden text-muted-foreground/40 sm:inline">
                        /
                      </span>
                      <span className="hidden text-muted-foreground sm:inline">
                        {session.branch}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="truncate text-muted-foreground">
                  {session.title}
                </span>
              )}
            </div>
          </div>

          {/* Right-side actions */}
          <div className="flex items-center gap-1 xl:gap-2">
            <div className="flex items-center gap-1">
              {hasRepo &&
                (hasExistingPr ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0 xl:w-auto xl:px-3"
                    disabled
                  >
                    <GitPullRequest className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">
                      View PR #{session.prNumber}
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0 xl:w-auto xl:px-3"
                    disabled
                  >
                    <GitPullRequest className="h-4 w-4 xl:mr-2" />
                    <span className="hidden xl:inline">Create PR</span>
                  </Button>
                ))}
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Messages area with centered spinner */}
      <div className="relative flex-1 overflow-hidden">
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>

      {/* Input area shell */}
      <div className="p-4 pb-2 sm:pb-8">
        <div className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-2xl bg-muted">
            <div className="px-4 pb-2 pt-3">
              <textarea
                disabled
                rows={1}
                placeholder="Request changes or ask a question..."
                className="w-full resize-none overflow-y-auto bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
                style={{ minHeight: "24px" }}
              />
            </div>
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-muted-foreground/10" />
              </div>
              <div className="flex items-center gap-1">
                <div className="h-8 w-8 rounded-full bg-muted-foreground/10" />
                <div className="h-8 w-8 rounded-full bg-muted-foreground/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
