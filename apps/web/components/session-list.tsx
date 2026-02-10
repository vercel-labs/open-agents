"use client";

import { GitMerge } from "lucide-react";
import type { Session } from "@/lib/db/schema";

interface SessionListProps {
  sessions: Session[];
  onSessionClick: (sessionId: string) => void;
  emptyMessage?: string;
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
    <div className="flex items-center gap-1 text-sm font-mono">
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
      <div className="flex items-center gap-1 rounded-md bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
        <GitMerge className="h-3 w-3" />
        <span>Merged</span>
      </div>
    );
  }

  return null;
}

export function SessionList({
  sessions,
  onSessionClick,
  emptyMessage = "No sessions yet. Create one above!",
}: SessionListProps) {
  const groupedSessions = groupSessionsByDate(sessions);

  if (sessions.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Array.from(groupedSessions.entries()).map(
        ([dateGroup, groupSessions]) => (
          <div key={dateGroup}>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {dateGroup}
            </h3>
            <div className="space-y-1">
              {groupSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSessionClick(session.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {session.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
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
                  <div className="flex shrink-0 items-center gap-3">
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
        ),
      )}
    </div>
  );
}
