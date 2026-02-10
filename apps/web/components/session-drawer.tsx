"use client";

import { Archive, GitMerge } from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Session } from "@/lib/db/schema";

interface SessionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
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

function groupSessionsByDate(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>();

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
      {added !== null ? <span className="text-green-500">+{added}</span> : null}
      {removed !== null ? (
        <span className="text-red-400">-{removed}</span>
      ) : null}
    </div>
  );
}

function PrStatus({ status }: { status: "open" | "merged" | "closed" | null }) {
  if (!status || status === "open") return null;

  if (status === "merged") {
    return (
      <div className="flex items-center gap-1 rounded-md bg-purple-500/20 px-1.5 py-0.5 text-xs text-purple-400">
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
  sessions: Session[];
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
            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {session.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatTime(new Date(session.createdAt))}
                {session.repoName && (
                  <>
                    {" "}
                    <span className="text-muted-foreground/50">-</span>{" "}
                    {session.repoName}
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <PrStatus status={session.prStatus} />
              <DiffStats
                added={session.linesAdded}
                removed={session.linesRemoved}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

type DrawerTab = "sessions" | "archive";

export function SessionDrawer({
  open,
  onOpenChange,
  sessions,
  loading,
  onSessionClick,
}: SessionDrawerProps) {
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 sm:max-w-sm"
      >
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Sessions</SheetTitle>
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
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {loading ? (
              <DrawerSkeleton />
            ) : displayedSessions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {tab === "sessions"
                  ? "No sessions yet"
                  : "No archived sessions"}
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
      </SheetContent>
    </Sheet>
  );
}

function DrawerSkeleton() {
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
