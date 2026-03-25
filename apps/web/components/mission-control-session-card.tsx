"use client";

import {
  Archive,
  Circle,
  EllipsisVertical,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Loader2,
  Pencil,
} from "lucide-react";
import type { CSSProperties } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";
import {
  getMissionControlStatusLabel,
  type MissionControlLane,
} from "./mission-control-session";

type MissionControlSessionCardProps = {
  session: SessionWithUnread;
  lane: MissionControlLane;
  isActive: boolean;
  isPending: boolean;
  variant?: "mission-control" | "history";
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession?: (session: SessionWithUnread) => void;
};

const rowPerformanceStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "3.5rem",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "now";
  }

  if (diffMins < 60) {
    return `${diffMins}m`;
  }

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  if (diffDays < 7) {
    return `${diffDays}d`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getGitHubPrUrl(session: SessionWithUnread): string | null {
  if (!session.prNumber || !session.repoOwner || !session.repoName) {
    return null;
  }

  return `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
}

function getGitHubRepoUrl(session: SessionWithUnread): string | null {
  if (!session.repoOwner || !session.repoName) {
    return null;
  }

  return `https://github.com/${session.repoOwner}/${session.repoName}`;
}

function StatusIndicator({
  lane,
  isStreaming,
  variant,
}: {
  lane: MissionControlLane;
  isStreaming: boolean;
  variant: "mission-control" | "history";
}) {
  if (variant === "history") {
    return (
      <Circle className="mt-[3px] h-2 w-2 shrink-0 fill-muted-foreground/30 text-muted-foreground/30" />
    );
  }

  if (isStreaming) {
    return (
      <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-sky-500" />
    );
  }

  const dotColor =
    lane === "needs-you"
      ? "fill-amber-500 text-amber-500"
      : lane === "running"
        ? "fill-sky-500 text-sky-500"
        : "fill-emerald-500 text-emerald-500";

  return <Circle className={cn("mt-[3px] h-2 w-2 shrink-0", dotColor)} />;
}

export function MissionControlSessionCard({
  session,
  lane,
  isActive,
  isPending,
  variant = "mission-control",
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: MissionControlSessionCardProps) {
  const lastActivityLabel = formatRelativeTime(
    new Date(session.lastActivityAt ?? session.createdAt),
  );
  const statusLabel = getMissionControlStatusLabel(session);
  const prUrl = getGitHubPrUrl(session);
  const repoUrl = getGitHubRepoUrl(session);
  const repoShortName =
    session.repoOwner && session.repoName
      ? `${session.repoOwner}/${session.repoName}`
      : (session.repoName ?? null);

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        isPending && "opacity-60",
      )}
      style={rowPerformanceStyle}
      data-session-id={session.id}
    >
      <StatusIndicator
        lane={lane}
        isStreaming={session.hasStreaming}
        variant={variant}
      />

      <button
        type="button"
        onClick={() => onSessionClick(session)}
        onMouseEnter={() => onSessionPrefetch(session)}
        onFocus={() => onSessionPrefetch(session)}
        className="min-w-0 flex-1 text-left"
        aria-current={isActive ? "page" : undefined}
        aria-busy={isPending}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[13px] font-medium leading-tight text-foreground">
            {session.title}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {lastActivityLabel}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          {variant !== "history" ? (
            <span
              className={cn(
                "text-[11px] font-medium",
                lane === "needs-you"
                  ? "text-amber-600 dark:text-amber-400"
                  : lane === "running"
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-muted-foreground",
              )}
            >
              {statusLabel}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Archived</span>
          )}

          {repoShortName ? (
            <>
              <span className="text-[11px] text-muted-foreground/50">·</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {repoShortName}
              </span>
            </>
          ) : null}

          {session.prNumber ? (
            <>
              <span className="text-[11px] text-muted-foreground/50">·</span>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-[11px] font-medium",
                  session.prStatus === "merged"
                    ? "text-purple-600 dark:text-purple-400"
                    : "text-green-600 dark:text-green-400",
                )}
              >
                {session.prStatus === "merged" ? (
                  <GitMerge className="h-2.5 w-2.5" />
                ) : (
                  <GitPullRequest className="h-2.5 w-2.5" />
                )}
                #{session.prNumber}
              </span>
            </>
          ) : null}

          {session.linesAdded !== null || session.linesRemoved !== null ? (
            <>
              <span className="text-[11px] text-muted-foreground/50">·</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {session.linesAdded !== null ? (
                  <span className="text-green-600 dark:text-green-400">
                    +{session.linesAdded}
                  </span>
                ) : null}
                {session.linesAdded !== null && session.linesRemoved !== null
                  ? " "
                  : null}
                {session.linesRemoved !== null ? (
                  <span className="text-red-600 dark:text-red-400">
                    -{session.linesRemoved}
                  </span>
                ) : null}
              </span>
            </>
          ) : null}
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
              "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
              isActive && "opacity-100",
            )}
            aria-label={`Actions for ${session.title}`}
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => onSessionClick(session)}
            className="gap-2"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open session</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onOpenRenameDialog(session)}
            className="gap-2"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Rename</span>
          </DropdownMenuItem>
          {onArchiveSession ? (
            <DropdownMenuItem
              onClick={() => onArchiveSession(session)}
              className="gap-2"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Archive</span>
            </DropdownMenuItem>
          ) : null}
          {prUrl || repoUrl ? <DropdownMenuSeparator /> : null}
          {prUrl ? (
            <DropdownMenuItem
              onClick={() =>
                window.open(prUrl, "_blank", "noopener,noreferrer")
              }
              className="gap-2"
            >
              {session.prStatus === "merged" ? (
                <GitMerge className="h-3.5 w-3.5" />
              ) : (
                <GitPullRequest className="h-3.5 w-3.5" />
              )}
              <span>
                {session.prStatus === "merged" ? "View merged PR" : "View PR"}
                {session.prNumber ? ` #${session.prNumber}` : ""}
              </span>
            </DropdownMenuItem>
          ) : null}
          {repoUrl ? (
            <DropdownMenuItem
              onClick={() =>
                window.open(repoUrl, "_blank", "noopener,noreferrer")
              }
              className="gap-2"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>View on GitHub</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
