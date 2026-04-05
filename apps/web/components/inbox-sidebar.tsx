"use client";

import {
  Archive,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  Monitor,
  Plus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BranchPickerDialog } from "@/components/branch-picker-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  onRenameSession?: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onOpenNewSession: () => void;
  onCreateSessionForRepo: (repoOwner: string, repoName: string) => void;
  onCreateSessionFromBranch: (
    repoOwner: string,
    repoName: string,
    branch: string,
  ) => void;
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
  containIntrinsicSize: "2.25rem",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

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
  if (added === 0 && removed === 0) return null;

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

function getSessionStatusIcon(session: SessionWithUnread) {
  // Actively streaming / waiting for LLM
  if (session.hasStreaming) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
    );
  }

  // PR merged → purple merge icon
  if (session.prNumber && session.prStatus === "merged") {
    return <GitMerge className="h-3.5 w-3.5 shrink-0 text-purple-500" />;
  }

  // PR open → yellow-orange PR icon (awaiting review)
  if (session.prNumber && session.prStatus === "open") {
    return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  }

  // PR closed (not merged)
  if (session.prNumber && session.prStatus === "closed") {
    return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-red-500" />;
  }

  // Has a branch with code changes → needs human follow-up
  const hasDiff = session.linesAdded || session.linesRemoved;
  if (session.branch && hasDiff) {
    return <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }

  // Has a branch but no changes yet → new session, still getting started
  if (session.branch) {
    return (
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    );
  }

  // Creating / instantiating sandbox (no branch yet)
  if (session.status === "running") {
    return (
      <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    );
  }

  // Default: sandbox icon
  return <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

function getSessionStatusLabel(session: SessionWithUnread): string {
  if (session.hasStreaming) return "Working";
  if (session.prNumber && session.prStatus === "merged") return "Merged";
  if (session.prNumber && session.prStatus === "open") return "Open PR";
  if (session.prNumber && session.prStatus === "closed") return "Closed";
  const hasDiff = session.linesAdded || session.linesRemoved;
  if (session.branch && hasDiff) return "Needs attention";
  if (session.branch) return "New session";
  if (session.status === "running") return "Setting up";
  if (session.status === "completed") return "Completed";
  if (session.status === "failed") return "Failed";
  if (session.status === "archived") return "Archived";
  return "Idle";
}

function getSessionPrUrl(session: SessionWithUnread): string | null {
  if (!session.prNumber || !session.repoOwner || !session.repoName) return null;
  return `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
}

function SessionPopoverContent({ session }: { session: SessionWithUnread }) {
  const lastActivityLabel = formatRelativeTime(
    new Date(session.lastActivityAt ?? session.createdAt),
  );
  const prUrl = getSessionPrUrl(session);
  const hasDiff = session.linesAdded !== null || session.linesRemoved !== null;
  const hasSecondRow = hasDiff || prUrl;

  return (
    <div className="space-y-2">
      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {session.title}
      </p>

      {/* Status · branch · time — all inline, never wraps */}
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
        <span className="shrink-0">{getSessionStatusIcon(session)}</span>
        <span className="shrink-0">{getSessionStatusLabel(session)}</span>
        {session.branch ? (
          <>
            <span className="shrink-0 text-muted-foreground/40">·</span>
            <span className="min-w-0 truncate font-mono text-[11px]">
              {session.branch}
            </span>
          </>
        ) : null}
        <span className="shrink-0 text-muted-foreground/40">·</span>
        <span className="shrink-0">{lastActivityLabel}</span>
      </div>

      {/* Diff count · PR link — all inline */}
      {hasSecondRow ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {hasDiff ? (
            <DiffStats
              added={session.linesAdded}
              removed={session.linesRemoved}
            />
          ) : null}
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <GitPullRequest className="h-3 w-3" />
              <span>#{session.prNumber}</span>
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
  onArchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  isPending,
  onSessionClick,
  onSessionPrefetch,
  onArchiveSession,
}: SessionRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDiff = session.linesAdded !== null || session.linesRemoved !== null;
  const showArchiveButton = isHovered && session.status !== "archived";

  const handleMouseEnter = useCallback(() => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
    hoverTimeoutRef.current = setTimeout(() => {
      setPopoverOpen(true);
    }, 500);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // Immediately hide archive button
    setIsHovered(false);
    // Delay popover close so user can move mouse to it
    leaveTimeoutRef.current = setTimeout(() => {
      setPopoverOpen(false);
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`group relative flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,opacity] cursor-pointer ${
            isActive ? "bg-sidebar-active" : "hover:bg-muted/50"
          } ${isPending ? "opacity-80" : "opacity-100"}`}
          style={sessionRowPerformanceStyle}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={() => onSessionClick(session)}
          onFocus={() => onSessionPrefetch(session)}
          aria-busy={isPending}
        >
          {/* Status icon */}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {getSessionStatusIcon(session)}
          </span>

          {/* Session name */}
          <span className="min-w-0 flex-1 text-left">
            <p
              className={`truncate text-[13px] leading-5 ${
                session.hasUnread && !isActive
                  ? "font-semibold text-foreground"
                  : "font-normal text-foreground/75"
              }`}
            >
              {session.title}
            </p>
          </span>

          {/* Right side: shrink-to-fit so diff stats never overlap title */}
          <span className="flex shrink-0 items-center justify-end">
            {showArchiveButton ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    aria-label="Archive session"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveSession(session);
                    }}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  Archive session
                </TooltipContent>
              </Tooltip>
            ) : hasDiff ? (
              <DiffStats
                added={session.linesAdded}
                removed={session.linesRemoved}
              />
            ) : null}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-72 p-3"
        onMouseEnter={() => {
          if (leaveTimeoutRef.current) {
            clearTimeout(leaveTimeoutRef.current);
            leaveTimeoutRef.current = null;
          }
        }}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SessionPopoverContent session={session} />
      </PopoverContent>
    </Popover>
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
  onRenameSession: _onRenameSession,
  onArchiveSession,
  onOpenNewSession,
  onCreateSessionForRepo,
  onCreateSessionFromBranch,
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
  const [branchPickerRepo, setBranchPickerRepo] = useState<{
    owner: string;
    repo: string;
  } | null>(null);
  const [isCreatingFromBranch, setIsCreatingFromBranch] = useState(false);
  const [archiveConfirmSession, setArchiveConfirmSession] =
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

  const handleArchiveSession = useCallback((session: SessionWithUnread) => {
    setArchiveConfirmSession(session);
  }, []);

  const handleConfirmArchive = useCallback(async () => {
    if (!archiveConfirmSession) return;
    const session = archiveConfirmSession;
    setArchiveConfirmSession(null);
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
  }, [archiveConfirmSession, archivedCount, onArchiveSession]);

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

  const handleCreateForRepo = useCallback(
    (owner: string, repo: string) => {
      onCreateSessionForRepo(owner, repo);
    },
    [onCreateSessionForRepo],
  );

  const handleOpenBranchPicker = useCallback((owner: string, repo: string) => {
    setBranchPickerRepo({ owner, repo });
  }, []);

  const handleBranchSelected = useCallback(
    async (branch: string) => {
      if (!branchPickerRepo) return;
      setIsCreatingFromBranch(true);
      try {
        await onCreateSessionFromBranch(
          branchPickerRepo.owner,
          branchPickerRepo.repo,
          branch,
        );
        setBranchPickerRepo(null);
      } catch (error) {
        console.error("Failed to create session from branch:", error);
      } finally {
        setIsCreatingFromBranch(false);
      }
    },
    [branchPickerRepo, onCreateSessionFromBranch],
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
                const groupContentId = getRepoGroupContentId(group.id);

                const groupRepoOwner =
                  group.sessions[0]?.repoOwner?.trim() ?? "";
                const groupRepoName = group.sessions[0]?.repoName?.trim() ?? "";
                const hasRepo = Boolean(groupRepoOwner && groupRepoName);

                return (
                  <section key={group.id} className="space-y-1.5">
                    <div
                      className={`group/repo flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        groupHasActiveSession
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground/85"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleRepoGroup(group.id)}
                        aria-controls={groupContentId}
                        aria-expanded={!isCollapsed}
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/80">
                          <FolderGit2 className="h-3.5 w-3.5 group-hover/repo:hidden" />
                          <ChevronDown
                            className={`hidden h-3.5 w-3.5 text-muted-foreground/70 transition-transform duration-200 group-hover/repo:block ${
                              isCollapsed ? "-rotate-90" : "rotate-0"
                            }`}
                          />
                        </span>
                        <span className="min-w-0 truncate text-[12px] font-medium">
                          {group.label}
                        </span>
                      </button>
                      {hasRepo ? (
                        <span className="hidden shrink-0 items-center gap-0.5 group-hover/repo:flex">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenBranchPicker(
                                    groupRepoOwner,
                                    groupRepoName,
                                  );
                                }}
                                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                                aria-label={`Create session from branch for ${group.label}`}
                              >
                                <GitBranch className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4}>
                              Create from branch
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCreateForRepo(
                                    groupRepoOwner,
                                    groupRepoName,
                                  );
                                }}
                                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                                aria-label={`Create session for ${group.label}`}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4}>
                              Create session
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      ) : null}
                    </div>
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
                        <div className="ml-4 space-y-1 border-l border-border/40 pl-1.5">
                          {group.sessions.map((session) => (
                            <SessionRow
                              key={session.id}
                              session={session}
                              isActive={session.id === activeSessionId}
                              isPending={session.id === pendingSessionId}
                              onSessionClick={handleSessionClick}
                              onSessionPrefetch={handleSessionPrefetch}
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

      {branchPickerRepo ? (
        <BranchPickerDialog
          open={Boolean(branchPickerRepo)}
          onOpenChange={(open) => {
            if (!open) setBranchPickerRepo(null);
          }}
          owner={branchPickerRepo.owner}
          repo={branchPickerRepo.repo}
          isCreating={isCreatingFromBranch}
          onSelectBranch={handleBranchSelected}
        />
      ) : null}

      {/* Archive confirmation dialog */}
      <Dialog
        open={archiveConfirmSession !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveConfirmSession(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Archive session?</DialogTitle>
            <DialogDescription>
              This will stop the sandbox and archive the session. You can still
              view it in the archive tab.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                void handleConfirmArchive();
              }}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
