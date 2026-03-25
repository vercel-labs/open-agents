"use client";

import {
  Archive,
  ChevronDown,
  EllipsisVertical,
  FolderGit2,
  GitMerge,
  Loader2,
  Pencil,
  Plus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InboxSidebarRenameDialog } from "@/components/inbox-sidebar-rename-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { useLeaderboardRank } from "@/hooks/use-leaderboard-rank";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { getUsageLeaderboardDomain } from "@/lib/usage/leaderboard-domain";

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

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

const sessionRowPerformanceStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "3.25rem",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDomainOrg(domain: string): string {
  const dotIndex = domain.indexOf(".");
  const name = dotIndex > 0 ? domain.slice(0, dotIndex) : domain;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getAvatarFallback(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    return "?";
  }

  return normalized.slice(0, 2).toUpperCase();
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
    <span className="flex items-center gap-0.5 font-mono text-[10px]">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-500">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

function PrBadge({
  prNumber,
  status,
}: {
  prNumber: number | null;
  status: "open" | "merged" | "closed" | null;
}) {
  if (!prNumber) return null;

  if (status === "merged") {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-purple-700 dark:text-purple-400">
        <GitMerge className="h-2.5 w-2.5" />
        <span>#{prNumber}</span>
      </span>
    );
  }

  return <span className="text-[10px] text-muted-foreground">#{prNumber}</span>;
}

type SessionRepoGroup = {
  id: string;
  label: string;
  sessions: SessionWithUnread[];
};

function getRepoGroupId(session: SessionWithUnread): string {
  const repoName = session.repoName?.trim();
  const repoOwner = session.repoOwner?.trim();

  if (!repoName) {
    return "repo:unscoped";
  }

  return `repo:${repoOwner ?? ""}/${repoName}`.toLowerCase();
}

function getRepoGroupLabel(session: SessionWithUnread): string {
  const repoName = session.repoName?.trim();
  const repoOwner = session.repoOwner?.trim();

  if (!repoName) {
    return "No repository";
  }

  return repoOwner ? `${repoOwner}/${repoName}` : repoName;
}

function groupSessionsByRepo(
  sessions: SessionWithUnread[],
): SessionRepoGroup[] {
  const groups = new Map<string, SessionRepoGroup>();

  for (const session of sessions) {
    const groupId = getRepoGroupId(session);
    const existingGroup = groups.get(groupId);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      continue;
    }

    groups.set(groupId, {
      id: groupId,
      label: getRepoGroupLabel(session),
      sessions: [session],
    });
  }

  return Array.from(groups.values());
}

function getRepoGroupContentId(groupId: string): string {
  return `repo-group-panel-${groupId.replace(/[^a-z0-9-]+/gi, "-")}`;
}

type SessionRowProps = {
  session: SessionWithUnread;
  isActive: boolean;
  isPending: boolean;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  isPending,
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: SessionRowProps) {
  const isWorking = session.hasStreaming;
  const isUnread = session.hasUnread && !isActive;
  const lastActivityLabel = useMemo(
    () =>
      formatRelativeTime(new Date(session.lastActivityAt ?? session.createdAt)),
    [session.createdAt, session.lastActivityAt],
  );
  const metadataLabel =
    session.branch ??
    (isWorking ? "Working..." : !session.repoName ? "No repository" : null);
  const metadataLabelClassName = session.branch
    ? "truncate font-mono text-[11px]"
    : "truncate";
  const showMetadata =
    Boolean(metadataLabel) ||
    session.prNumber !== null ||
    session.linesAdded !== null ||
    session.linesRemoved !== null;

  return (
    <div
      className={`group relative flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,opacity] ${
        isActive
          ? "border-border/70 bg-sidebar-active shadow-sm"
          : "border-transparent hover:border-border/40 hover:bg-muted/50"
      } ${isPending ? "opacity-80" : "opacity-100"}`}
      style={sessionRowPerformanceStyle}
    >
      <div className="flex h-5 w-3 shrink-0 items-center justify-center">
        {isWorking ? (
          <span className="h-2 w-2 rounded-full bg-foreground/70 animate-pulse" />
        ) : isUnread ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onSessionClick(session)}
          onMouseEnter={() => onSessionPrefetch(session)}
          onFocus={() => onSessionPrefetch(session)}
          className="block w-full text-left"
          aria-busy={isPending}
        >
          <div className="flex min-w-0 items-center gap-2 pr-7">
            <p
              className={`min-w-0 flex-1 truncate text-sm ${
                isUnread || isWorking
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground"
              }`}
            >
              {session.title}
            </p>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span>{lastActivityLabel}</span>
            </span>
          </div>

          {showMetadata ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {metadataLabel ? (
                <span className={metadataLabelClassName}>{metadataLabel}</span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <PrBadge
                  prNumber={session.prNumber}
                  status={session.prStatus}
                />
                <DiffStats
                  added={session.linesAdded}
                  removed={session.linesRemoved}
                />
              </span>
            </div>
          ) : null}
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
            aria-label={`Open menu for ${session.title}`}
          >
            <EllipsisVertical className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => onOpenRenameDialog(session)}
            className="gap-2"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Rename session</span>
          </DropdownMenuItem>
          {session.status !== "archived" ? (
            <DropdownMenuItem
              onClick={() => onArchiveSession(session)}
              className="gap-2"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Archive session</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}, areSessionRowsEqual);

function areSessionRowsEqual(
  prev: SessionRowProps,
  next: SessionRowProps,
): boolean {
  if (prev.isActive !== next.isActive || prev.isPending !== next.isPending) {
    return false;
  }

  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.hasStreaming === next.session.hasStreaming &&
    prev.session.hasUnread === next.session.hasUnread &&
    prev.session.repoOwner === next.session.repoOwner &&
    prev.session.repoName === next.session.repoName &&
    prev.session.branch === next.session.branch &&
    prev.session.prNumber === next.session.prNumber &&
    prev.session.prStatus === next.session.prStatus &&
    prev.session.linesAdded === next.session.linesAdded &&
    prev.session.linesRemoved === next.session.linesRemoved &&
    String(prev.session.lastActivityAt) === String(next.session.lastActivityAt)
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
  const { rank: leaderboardRank, loading: leaderboardLoading } =
    useLeaderboardRank();
  const { isMobile, setOpenMobile } = useSidebar();
  const [showArchived, setShowArchived] = useState(false);
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
          throw new Error(data.error ?? "Failed to load archived sessions");
        }

        setArchivedSessions((current) => {
          if (replace) {
            return data.sessions;
          }

          const existingIds = new Set(current.map((session) => session.id));
          const nextSessions = data.sessions.filter(
            (session) => !existingIds.has(session.id),
          );

          return [...current, ...nextSessions];
        });
        lastLoadedArchivedCountRef.current = data.archivedCount;
        setHasMoreArchivedSessions(Boolean(data.pagination?.hasMore));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load archived sessions";
        setArchivedSessionsError(message);
      } finally {
        archivedRequestInFlightRef.current = false;
        setArchivedSessionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!showArchived) {
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
  }, [archivedCount, fetchArchivedSessionsPage, showArchived]);

  const activeSessions = sessions;
  const displayedSessions = showArchived ? archivedSessions : activeSessions;
  const showLoadingSkeleton =
    (!showArchived && sessionsLoading && sessions.length === 0) ||
    (showArchived && archivedSessionsLoading && archivedSessions.length === 0);
  const sidebarUser = session?.user ?? initialUser;
  const groupedSessions = useMemo(
    () => groupSessionsByRepo(displayedSessions),
    [displayedSessions],
  );
  const activeGroupId = useMemo(
    () =>
      groupedSessions.find((group) =>
        group.sessions.some((session) => session.id === activeSessionId),
      )?.id ?? null,
    [activeSessionId, groupedSessions],
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    setCollapsedGroupIds((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const group of groupedSessions) {
        const nextCollapsed =
          group.id === activeGroupId ? false : (current[group.id] ?? false);

        next[group.id] = nextCollapsed;

        if (current[group.id] !== nextCollapsed) {
          changed = true;
        }
      }

      if (!changed) {
        const currentIds = Object.keys(current);
        if (currentIds.length !== groupedSessions.length) {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [activeGroupId, groupedSessions]);

  const handleSessionClick = useCallback(
    (session: SessionWithUnread) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      onSessionClick(session);
    },
    [isMobile, onSessionClick, setOpenMobile],
  );

  const handleSessionPrefetch = useCallback(
    (session: SessionWithUnread) => {
      onSessionPrefetch(session);
    },
    [onSessionPrefetch],
  );

  const handleToggleRepoGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }, []);

  const handleArchiveSession = useCallback(
    async (session: SessionWithUnread) => {
      try {
        await onArchiveSession(session.id);
        setArchivedSessions((current) => {
          const nextSessions = [
            { ...session, status: "archived" as const },
            ...current.filter(
              (existingSession) => existingSession.id !== session.id,
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
      } catch (err) {
        console.error("Failed to archive session:", err);
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

  const handleOpenRenameDialog = useCallback((session: SessionWithUnread) => {
    setRenameDialogSession(session);
  }, []);

  const handleRenameArchivedSession = useCallback(
    (sessionId: string, title: string) => {
      setArchivedSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, title } : session,
        ),
      );
    },
    [],
  );

  return (
    <>
      <div className="border-b border-border p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center px-2 py-1.5 text-sm text-primary">
            <span>Sessions</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenNewSession}
            className="h-7 w-7"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              !showArchived
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
            onClick={() => setShowArchived(true)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showArchived
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="h-3 w-3" />
            Archive
            {archivedCount > 0 && (
              <span className="ml-1 text-muted-foreground">
                {archivedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showLoadingSkeleton ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-1.5 rounded-md px-3 py-2.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : displayedSessions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {showArchived
              ? (archivedSessionsError ?? "No archived sessions")
              : "No sessions yet"}
            {showArchived && archivedSessionsError ? (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetryArchivedSessions}
                >
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="space-y-3 p-1.5">
              {groupedSessions.map((group) => {
                const isCollapsed = collapsedGroupIds[group.id] ?? false;
                const groupHasActiveSession = group.id === activeGroupId;
                const groupHasUnread = group.sessions.some(
                  (session) =>
                    session.hasUnread && session.id !== activeSessionId,
                );
                const groupHasStreaming = group.sessions.some(
                  (session) => session.hasStreaming,
                );
                const groupContentId = getRepoGroupContentId(group.id);

                return (
                  <section key={group.id} className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleRepoGroup(group.id)}
                      aria-controls={groupContentId}
                      aria-expanded={!isCollapsed}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        groupHasActiveSession
                          ? "bg-muted/35 text-foreground"
                          : "text-muted-foreground hover:bg-muted/20 hover:text-foreground/85"
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/70 text-muted-foreground/80">
                        <FolderGit2 className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                        {group.label}
                      </span>
                      {groupHasStreaming ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                      ) : groupHasUnread ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                      ) : null}
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          groupHasActiveSession
                            ? "bg-background/80 text-foreground/65"
                            : "bg-muted/70 text-muted-foreground"
                        }`}
                      >
                        {group.sessions.length}
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 ${
                          isCollapsed ? "-rotate-90" : "rotate-0"
                        }`}
                      />
                    </button>
                    <div
                      id={groupContentId}
                      aria-hidden={isCollapsed}
                      inert={isCollapsed}
                      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                        isCollapsed
                          ? "grid-rows-[0fr] opacity-0 pointer-events-none"
                          : "grid-rows-[1fr] opacity-100"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="ml-5 space-y-1 border-l border-border/40 pl-2">
                          {group.sessions.map((session) => (
                            <SessionRow
                              key={session.id}
                              session={session}
                              isActive={session.id === activeSessionId}
                              isPending={session.id === pendingSessionId}
                              onSessionClick={handleSessionClick}
                              onSessionPrefetch={handleSessionPrefetch}
                              onOpenRenameDialog={handleOpenRenameDialog}
                              onArchiveSession={handleArchiveSession}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
            {showArchived &&
            (hasMoreArchivedSessions || archivedSessionsError) ? (
              <div className="px-3 pb-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
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
                      ? "Retry loading archived sessions"
                      : "Load more archived sessions"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {sidebarUser ? (
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg p-2">
            <Avatar className="h-9 w-9 shrink-0">
              {sidebarUser.avatar ? (
                <AvatarImage
                  src={sidebarUser.avatar}
                  alt={sidebarUser.username}
                />
              ) : null}
              <AvatarFallback>
                {getAvatarFallback(sidebarUser.username)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-none text-foreground">
                {sidebarUser.username}
              </p>
              {sidebarUser.email ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {sidebarUser.email}
                </p>
              ) : null}
              {leaderboardRank ? (
                <Link
                  href="/settings/leaderboard"
                  className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground"
                >
                  <span className="font-semibold tabular-nums text-foreground/70">
                    #{leaderboardRank.rank}
                  </span>{" "}
                  in {formatDomainOrg(leaderboardRank.domain)}
                </Link>
              ) : leaderboardLoading &&
                getUsageLeaderboardDomain(sidebarUser.email) ? (
                <span className="mt-1 block h-4 w-24 animate-pulse rounded bg-muted" />
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => router.push("/settings")}
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <InboxSidebarRenameDialog
        session={renameDialogSession}
        onClose={closeRenameDialog}
        onRenameSession={onRenameSession}
        onRenamed={handleRenameArchivedSession}
      />
    </>
  );
}
