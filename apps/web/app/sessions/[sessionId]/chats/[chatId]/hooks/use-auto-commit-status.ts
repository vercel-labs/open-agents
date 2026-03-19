"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@/lib/db/schema";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";

/**
 * Tracks optimistic auto-commit-in-progress state for the UI.
 *
 * When the chat stream closes, auto-commit runs server-side *after* the
 * stream is already closed. The immediate git-status refresh will still see
 * uncommitted changes, which causes the "Commit & Push" button to flash
 * before the server-side commit lands. This hook lets the UI show a loading
 * state instead.
 *
 * It also owns the staggered follow-up refresh schedule: when auto-commit
 * is enabled the hook fires the provided `refresh` callback at 3 s, 8 s,
 * and 16 s to catch the server-side commit finishing. Timeouts are managed
 * in a dedicated effect so unrelated re-renders cannot cancel them.
 */
export function useAutoCommitStatus(
  session: Session,
  gitStatus: SessionGitStatus | null,
  refresh: () => void,
) {
  const [isAutoCommitting, setIsAutoCommitting] = useState(false);

  const autoCommitEnabled = Boolean(
    session.autoCommitPushOverride &&
      session.cloneUrl &&
      session.repoOwner &&
      session.repoName,
  );

  // Called by the stream-completion effect to optimistically mark auto-commit
  // as in progress and kick off the staggered refresh schedule.
  const markAutoCommitStarted = useCallback(() => {
    if (autoCommitEnabled) {
      setIsAutoCommitting(true);
    }
  }, [autoCommitEnabled]);

  // Clear the flag once git status confirms there's nothing left to commit
  // (i.e. the server-side auto-commit has landed).
  const hasUncommittedChanges = gitStatus?.hasUncommittedChanges ?? false;
  const hasUnpushedCommits = gitStatus?.hasUnpushedCommits ?? false;
  useEffect(() => {
    if (isAutoCommitting && !hasUncommittedChanges && !hasUnpushedCommits) {
      setIsAutoCommitting(false);
    }
  }, [isAutoCommitting, hasUncommittedChanges, hasUnpushedCommits]);

  // Schedule staggered follow-up refreshes when auto-commit starts.
  // We use a ref for the refresh callback so the timeouts are never torn
  // down by callback reference changes — only by `isAutoCommitting`
  // transitioning back to false, or unmount.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!isAutoCommitting) return;

    const timeouts = [3000, 8000, 16000].map((delay) =>
      setTimeout(() => {
        refreshRef.current();
      }, delay),
    );

    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, [isAutoCommitting]);

  return { isAutoCommitting, markAutoCommitStarted } as const;
}
