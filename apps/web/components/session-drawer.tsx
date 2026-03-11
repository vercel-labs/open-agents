"use client";

import { Archive, GitMerge } from "lucide-react";
import { useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SessionWithUnread } from "@/hooks/use-sessions";

interface SessionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionWithUnread[];
  loading: boolean;
  onSessionClick: (sessionId: string) => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function groupSessionsByDate(
  sessions: SessionWithUnread[],
): Map<string, SessionWithUnread[]> {
  const groups = new Map<string, SessionWithUnread[]>();

  for (const session of sessions) {
    const date = new Date(session.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let groupKey: string;
    if (date.toDateString() === today.toDateString()) {
      groupKey = "TODAY";
    } else if (date.toDateString() === yesterday.toDateString()) {
      groupKey = "YESTERDAY";
    } else {
      groupKey = date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year:
          date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      });
    }

    const existing = groups.get(groupKey) ?? [];
    groups.set(groupKey, [...existing, session]);
  }

  return groups;
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;

  return (
    <div className="flex items-center gap-1 font-mono text-xs">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-500">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </div>
  );
}

function PrStatus({ status }: { status: "open" | "merged" | "closed" | null }) {
  if (!status || status === "open") return null;

  if (status === "merged") {
    return (
      <div className="flex items-center gap-1 rounded-md bg-purple-500/20 px-1.5 py-0.5 text-xs text-purple-700 dark:text-purple-400">
        <GitMerge className="h-3 w-3" />
        <span>Merged</span>
      </div>
    );
  }

  return null;
}

function SessionGroup({
  dateGroup,
  sessions,
  onSessionClick,
}: {
  dateGroup: string;
  sessions: SessionWithUnread[];
  onSessionClick: (sessionId: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {dateGroup}
      </h3>
      <div className="space-y-0.5">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSessionClick(session.id)}
            className="flex w-full items-start justify-between gap-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {session.hasStreaming ? (
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-zinc-600 animate-pulse dark:bg-white" />
              ) : session.hasUnread ? (
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {session.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {session.repoName ? (
                    <span className="truncate">
                      {session.repoName}
                      {session.branch && (
                        <span className="text-muted-foreground/50">
                          /{session.branch}
                        </span>
                      )}
                    </span>
                  ) : session.hasStreaming ? (
                    <span className="text-muted-foreground/60">Working...</span>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[11px] text-muted-foreground">
                {formatTime(
                  new Date(session.lastActivityAt ?? session.createdAt),
                )}
              </span>
              <div className="flex items-center gap-2">
                <PrStatus status={session.prStatus} />
                <DiffStats
                  added={session.linesAdded}
                  removed={session.linesRemoved}
                />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

type DrawerTab = "sessions" | "archive";

function SessionDrawerInner({
  sessions,
  loading,
  onSessionClick,
  onOpenChange,
}: Omit<SessionDrawerProps, "open">) {
  const [tab, setTab] = useState<DrawerTab>("sessions");

  const activeSessions = sessions.filter((s) => s.status !== "archived");
  const archivedSessions = sessions.filter((s) => s.status === "archived");
  const displayedSessions =
    tab === "sessions" ? activeSessions : archivedSessions;
  const groupedSessions = groupSessionsByDate(displayedSessions);

  const handleSessionClick = (sessionId: string) => {
    onSessionClick(sessionId);
    onOpenChange(false);
  };

  return (
    <>
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Sessions</h2>
        </div>
        <div className="flex gap-1 pt-1">
          <button
            type="button"
            onClick={() => setTab("sessions")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === "sessions"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
            {activeSessions.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                {activeSessions.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("archive")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === "archive"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="h-3 w-3" />
            Archive
            {archivedSessions.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                {archivedSessions.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {loading ? (
            <SessionDrawerSkeleton />
          ) : displayedSessions.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {tab === "sessions" ? "No sessions yet" : "No archived sessions"}
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(groupedSessions.entries()).map(
                ([dateGroup, groupSessions]) => (
                  <SessionGroup
                    key={dateGroup}
                    dateGroup={dateGroup}
                    sessions={groupSessions}
                    onSessionClick={handleSessionClick}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  );
}

export function SessionDrawer({
  open,
  onOpenChange,
  sessions,
  loading,
  onSessionClick,
}: SessionDrawerProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[85dvh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Sessions</DrawerTitle>
          </DrawerHeader>
          <SessionDrawerInner
            sessions={sessions}
            loading={loading}
            onSessionClick={onSessionClick}
            onOpenChange={onOpenChange}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 sm:max-w-sm"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Sessions</SheetTitle>
        </SheetHeader>
        <SessionDrawerInner
          sessions={sessions}
          loading={loading}
          onSessionClick={onSessionClick}
          onOpenChange={onOpenChange}
        />
      </SheetContent>
    </Sheet>
  );
}

function SessionDrawerSkeleton() {
  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-2 h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5 rounded-md px-3 py-2.5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
