"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";

const AUTO_COMMIT_REFRESH_DELAYS_MS = [3000, 8000, 16000] as const;
const AUTO_COMMIT_UI_TIMEOUT_MS = 30_000;

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
 *
 * The hook includes a hard timeout fallback so the UI does not get stuck in
 * "Committing..." when auto-commit is skipped (aborted stream) or fails.
 */
export function useAutoCommitStatus(
  autoCommitEnabled: boolean,
  gitStatus: SessionGitStatus | null,
  refresh: () => void,
) {
  const [isAutoCommitting, setIsAutoCommitting] = useState(false);
  const [autoCommitCycle, setAutoCommitCycle] = useState(0);

  // Called by the stream-completion effect to optimistically mark auto-commit
  // as in progress and kick off the staggered refresh schedule.
  const markAutoCommitStarted = useCallback(() => {
    if (!autoCommitEnabled) {
      return;
    }

    setIsAutoCommitting(true);
    setAutoCommitCycle((current) => current + 1);
  }, [autoCommitEnabled]);

  // If auto-commit has been disabled for this session while the optimistic
  // spinner is active, immediately clear the loading state.
  useEffect(() => {
    if (!autoCommitEnabled && isAutoCommitting) {
      setIsAutoCommitting(false);
    }
  }, [autoCommitEnabled, isAutoCommitting]);

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
  // transitioning back to false, unmount, or a new auto-commit cycle.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!isAutoCommitting || autoCommitCycle === 0) return;

    const refreshTimeouts = AUTO_COMMIT_REFRESH_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        refreshRef.current();
      }, delay),
    );

    const fallbackTimeout = setTimeout(() => {
      setIsAutoCommitting(false);
    }, AUTO_COMMIT_UI_TIMEOUT_MS);

    return () => {
      for (const t of refreshTimeouts) clearTimeout(t);
      clearTimeout(fallbackTimeout);
    };
  }, [isAutoCommitting, autoCommitCycle]);

  return { isAutoCommitting, markAutoCommitStarted } as const;
}
