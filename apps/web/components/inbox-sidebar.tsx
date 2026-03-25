"use client";

import { History, Plus, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InboxSidebarRenameDialog } from "@/components/inbox-sidebar-rename-dialog";
import { MissionControlSessionCard } from "@/components/mission-control-session-card";
import {
  getMissionControlLane,
  sortSessionsByRecentActivity,
  sortSessionsForMissionControl,
} from "@/components/mission-control-session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { cn } from "@/lib/utils";

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  sessionsLoading: boolean;
  activeSessionId: string;
  pendingSessionId: string | null;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onOpenNewSession: () => void;
  initialUser?: AuthSession["user"];
};

type ArchivedSessionsResponse = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  pagination?: {
    hasMore: boolean;
    nextOffset: number;
  };
  error?: string;
};

type SidebarTab = "active" | "history";

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

function getAvatarFallback(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    return "?";
  }

  return normalized.slice(0, 2).toUpperCase();
}

function SidebarSkeleton() {
  return (
    <div className="space-y-1 px-2 py-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex items-start gap-3 rounded-lg px-3 py-2.5"
        >
          <div className="mt-[3px] h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-8 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxSidebar({
  sessions,
  archivedCount,
  sessionsLoading,
  activeSessionId,
  pendingSessionId,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onOpenNewSession,
  initialUser,
}: InboxSidebarProps) {
  const router = useRouter();
  const { session } = useSession();
  const [activeTab, setActiveTab] = useState<SidebarTab>("active");
  const [archivedSessions, setArchivedSessions] = useState<SessionWithUnread[]>(
    [],
  );
  const [archivedSessionsLoading, setArchivedSessionsLoading] = useState(false);
  const [archivedSessionsError, setArchivedSessionsError] = useState<
    string | null
  >(null);
  const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(false);
  const archivedRequestInFlightRef = useRef(false);
  const lastLoadedArchivedCountRef = useRef(0);
  const [renameDialogSession, setRenameDialogSession] =
    useState<SessionWithUnread | null>(null);

  const fetchArchivedSessionsPage = useCallback(
    async ({ offset, replace }: { offset: number; replace: boolean }) => {
      if (archivedRequestInFlightRef.current) {
        return;
      }

      archivedRequestInFlightRef.current = true;
      setArchivedSessionsLoading(true);
      setArchivedSessionsError(null);

      try {
        const query = new URLSearchParams({
          status: "archived",
          limit: String(ARCHIVED_SESSIONS_PAGE_SIZE),
          offset: String(offset),
        });
        const res = await fetch(`/api/sessions?${query.toString()}`);
        const data = (await res.json()) as ArchivedSessionsResponse;

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load history");
        }

        setArchivedSessions((current) => {
          if (replace) {
            return data.sessions;
          }

          const existingIds = new Set(
            current.map((targetSession) => targetSession.id),
          );
          const nextSessions = data.sessions.filter(
            (targetSession) => !existingIds.has(targetSession.id),
          );

          return [...current, ...nextSessions];
        });
        lastLoadedArchivedCountRef.current = data.archivedCount;
        setHasMoreArchivedSessions(Boolean(data.pagination?.hasMore));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load history";
        setArchivedSessionsError(message);
      } finally {
        archivedRequestInFlightRef.current = false;
        setArchivedSessionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "history") {
      return;
    }

    if (archivedCount === 0) {
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      lastLoadedArchivedCountRef.current = 0;
      return;
    }

    if (lastLoadedArchivedCountRef.current === archivedCount) {
      return;
    }

    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [activeTab, archivedCount, fetchArchivedSessionsPage]);

  const sortedActiveSessions = useMemo(
    () => sortSessionsForMissionControl(sessions),
    [sessions],
  );
  const sortedArchivedSessions = useMemo(
    () => sortSessionsByRecentActivity(archivedSessions),
    [archivedSessions],
  );
  const showActiveLoadingState = sessionsLoading && sessions.length === 0;
  const showHistoryLoadingState =
    (archivedSessionsLoading && sortedArchivedSessions.length === 0) ||
    (activeTab === "history" &&
      archivedCount > 0 &&
      sortedArchivedSessions.length === 0 &&
      lastLoadedArchivedCountRef.current !== archivedCount &&
      !archivedSessionsError);
  const sidebarUser = session?.user ?? initialUser;

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionClick(targetSession);
    },
    [onSessionClick],
  );

  const handleSessionPrefetch = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionPrefetch(targetSession);
    },
    [onSessionPrefetch],
  );

  const handleArchiveSession = useCallback(
    async (targetSession: SessionWithUnread) => {
      try {
        await onArchiveSession(targetSession.id);
        setArchivedSessions((current) => {
          const nextSessions = [
            { ...targetSession, status: "archived" as const },
            ...current.filter(
              (sessionItem) => sessionItem.id !== targetSession.id,
            ),
          ];
          const maxCachedSessions = Math.max(
            current.length,
            ARCHIVED_SESSIONS_PAGE_SIZE,
          );

          return nextSessions.slice(0, maxCachedSessions);
        });
        setHasMoreArchivedSessions(
          (currentHasMore) =>
            currentHasMore || archivedCount + 1 > ARCHIVED_SESSIONS_PAGE_SIZE,
        );
      } catch (error) {
        console.error("Failed to archive session:", error);
      }
    },
    [archivedCount, onArchiveSession],
  );

  const handleLoadMoreArchivedSessions = useCallback(() => {
    if (archivedSessionsLoading) {
      return;
    }

    void fetchArchivedSessionsPage({
      offset: archivedSessions.length,
      replace: false,
    });
  }, [
    archivedSessions.length,
    archivedSessionsLoading,
    fetchArchivedSessionsPage,
  ]);

  const handleRetryArchivedSessions = useCallback(() => {
    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [fetchArchivedSessionsPage]);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogSession(null);
  }, []);

  const handleOpenRenameDialog = useCallback(
    (targetSession: SessionWithUnread) => {
      setRenameDialogSession(targetSession);
    },
    [],
  );

  const handleRenameArchivedSession = useCallback(
    (sessionId: string, title: string) => {
      setArchivedSessions((current) =>
        current.map((targetSession) =>
          targetSession.id === sessionId
            ? { ...targetSession, title }
            : targetSession,
        ),
      );
    },
    [],
  );

  const renderSessionRow = useCallback(
    (
      targetSession: SessionWithUnread,
      variant: "mission-control" | "history" = "mission-control",
    ) => (
      <MissionControlSessionCard
        key={targetSession.id}
        session={targetSession}
        lane={getMissionControlLane(targetSession)}
        variant={variant}
        isActive={targetSession.id === activeSessionId}
        isPending={targetSession.id === pendingSessionId}
        onSessionClick={handleSessionClick}
        onSessionPrefetch={handleSessionPrefetch}
        onOpenRenameDialog={handleOpenRenameDialog}
        onArchiveSession={
          variant === "mission-control" ? handleArchiveSession : undefined
        }
      />
    ),
    [
      activeSessionId,
      handleArchiveSession,
      handleOpenRenameDialog,
      handleSessionClick,
      handleSessionPrefetch,
      pendingSessionId,
    ],
  );

  // Count active sessions by lane for the subtle indicators
  const laneCounts = useMemo(() => {
    let needsYou = 0;
    let running = 0;
    for (const s of sessions) {
      const lane = getMissionControlLane(s);
      if (lane === "needs-you") {
        needsYou++;
      } else if (lane === "running") {
        running++;
      }
    }
    return { needsYou, running };
  }, [sessions]);

  return (
    <>
      {/* Header */}
      <div className="border-b border-border/70 bg-background">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Sessions
          </h1>

          <div className="flex items-center gap-1">
            {laneCounts.needsYou > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {laneCounts.needsYou}
              </span>
            ) : null}
            {laneCounts.running > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                {laneCounts.running}
              </span>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onOpenNewSession}
              aria-label="New session"
            >
              <Plus className="h-4 w-4" />
            </Button>

            {sidebarUser ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => router.push("/settings")}
                aria-label="Settings"
              >
                <Avatar className="h-5 w-5">
                  {sidebarUser.avatar ? (
                    <AvatarImage
                      src={sidebarUser.avatar}
                      alt={sidebarUser.username}
                    />
                  ) : null}
                  <AvatarFallback className="text-[8px]">
                    {getAvatarFallback(sidebarUser.username)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => router.push("/settings")}
                aria-label="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 px-4">
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={cn(
              "relative px-3 pb-2 text-[13px] font-medium transition-colors",
              activeTab === "active"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Active
            {activeTab === "active" ? (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-foreground" />
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={cn(
              "relative flex items-center gap-1.5 px-3 pb-2 text-[13px] font-medium transition-colors",
              activeTab === "history"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <History className="h-3 w-3" />
            History
            {archivedCount > 0 ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {archivedCount}
              </span>
            ) : null}
            {activeTab === "history" ? (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-foreground" />
            ) : null}
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "active" ? (
          showActiveLoadingState ? (
            <SidebarSkeleton />
          ) : sessions.length === 0 ? (
            <div className="px-4 py-8">
              <Empty className="rounded-xl border border-dashed border-border/70">
                <EmptyMedia variant="icon">
                  <Plus className="h-5 w-5" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No sessions yet</EmptyTitle>
                  <EmptyDescription>
                    Start a session to begin working with the agent.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" size="sm" onClick={onOpenNewSession}>
                    <Plus className="h-4 w-4" />
                    <span>New session</span>
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <div className="px-2 py-1">
              {sortedActiveSessions.map((s) => renderSessionRow(s))}
            </div>
          )
        ) : showHistoryLoadingState ? (
          <SidebarSkeleton />
        ) : archivedSessionsError && sortedArchivedSessions.length === 0 ? (
          <div className="px-4 py-8">
            <Empty className="rounded-xl border border-dashed border-border/70">
              <EmptyMedia variant="icon">
                <History className="h-5 w-5" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>History unavailable</EmptyTitle>
                <EmptyDescription>{archivedSessionsError}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetryArchivedSessions}
                >
                  Retry
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : archivedCount === 0 ? (
          <div className="px-4 py-8">
            <Empty className="rounded-xl border border-dashed border-border/70">
              <EmptyMedia variant="icon">
                <History className="h-5 w-5" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No archived sessions</EmptyTitle>
                <EmptyDescription>
                  Archived sessions will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="px-2 py-1">
            {sortedArchivedSessions.map((s) => renderSessionRow(s, "history"))}

            {hasMoreArchivedSessions || archivedSessionsError ? (
              <div className="px-3 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={
                    archivedSessionsError
                      ? handleRetryArchivedSessions
                      : handleLoadMoreArchivedSessions
                  }
                  disabled={archivedSessionsLoading}
                >
                  {archivedSessionsLoading
                    ? "Loading..."
                    : archivedSessionsError
                      ? "Retry"
                      : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <InboxSidebarRenameDialog
        session={renameDialogSession}
        onClose={closeRenameDialog}
        onRenameSession={onRenameSession}
        onRenamed={handleRenameArchivedSession}
      />
    </>
  );
}
