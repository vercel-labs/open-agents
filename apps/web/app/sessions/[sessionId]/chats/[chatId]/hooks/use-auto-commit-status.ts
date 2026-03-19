"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@/lib/db/schema";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";

/**
 * Determines whether the given session is configured for auto-commit-and-push.
 * The session needs the override flag *and* a connected repo.
 */
function isAutoCommitSession(session: Session): boolean {
  return Boolean(
    session.autoCommitPushOverride &&
      session.cloneUrl &&
      session.repoOwner &&
      session.repoName,
  );
}

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

  // Called by the stream-completion effect to optimistically mark auto-commit
  // as in progress.
  const markAutoCommitStarted = useCallback(() => {
    if (isAutoCommitSession(session)) {
      setIsAutoCommitting(true);
    }
  }, [session]);

  // Clear the flag once git status confirms there's nothing left to commit
  // (i.e. the server-side auto-commit has landed).
  const hasUncommittedChanges = gitStatus?.hasUncommittedChanges ?? false;
  const hasUnpushedCommits = gitStatus?.hasUnpushedCommits ?? false;
  useEffect(() => {
    if (isAutoCommitting && !hasUncommittedChanges && !hasUnpushedCommits) {
      setIsAutoCommitting(false);
    }
  }, [isAutoCommitting, hasUncommittedChanges, hasUnpushedCommits]);

  // Return the follow-up delay schedule for the post-stream refresh effect.
  // Auto-commit involves an LLM call + git push and can take 5-15 s, so we
  // use a longer schedule to ensure the UI eventually reconciles.
  const followUpDelays = isAutoCommitSession(session)
    ? [3000, 8000, 16000]
    : [3000];

  return { isAutoCommitting, markAutoCommitStarted, followUpDelays } as const;
}
