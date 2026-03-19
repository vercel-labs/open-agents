"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@/lib/db/schema";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";

const AUTO_COMMIT_DELAYS = [3000, 8000, 16000];
const DEFAULT_DELAYS = [3000];

/**
 * Tracks optimistic auto-commit-in-progress state for the UI.
 *
 * When the chat stream closes, auto-commit runs server-side *after* the
 * stream is already closed. The immediate git-status refresh will still see
 * uncommitted changes, which causes the "Commit & Push" button to flash
 * before the server-side commit lands. This hook lets the UI show a loading
 * state instead.
 *
 * It also returns the appropriate follow-up refresh delays: when auto-commit
 * is enabled the schedule is longer (3 s, 8 s, 16 s) so later refreshes
 * catch the server-side commit finishing.
 */
export function useAutoCommitStatus(
  session: Session,
  gitStatus: SessionGitStatus | null,
) {
  const [isAutoCommitting, setIsAutoCommitting] = useState(false);

  const autoCommitEnabled = Boolean(
    session.autoCommitPushOverride &&
      session.cloneUrl &&
      session.repoOwner &&
      session.repoName,
  );

  // Called by the stream-completion effect to optimistically mark auto-commit
  // as in progress.
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

  // Stable array references so the consumer's effect deps don't churn.
  const followUpDelays = useMemo(
    () => (autoCommitEnabled ? AUTO_COMMIT_DELAYS : DEFAULT_DELAYS),
    [autoCommitEnabled],
  );

  return { isAutoCommitting, markAutoCommitStarted, followUpDelays } as const;
}
