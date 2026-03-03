"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SessionWithUnread } from "@/hooks/use-sessions";

type StreamingItem = { id: string; streaming: boolean };

/**
 * Pure detection logic: given the previous set of streaming IDs and the current
 * list of items, return the IDs that just stopped streaming and are not the
 * active item.
 */
export function detectCompletedSessions(
  prevStreamingIds: Set<string>,
  items: StreamingItem[],
  activeId: string | null,
): string[] {
  const currentlyStreaming = new Set(
    items.filter((s) => s.streaming).map((s) => s.id),
  );

  const completed: string[] = [];
  for (const id of prevStreamingIds) {
    if (!currentlyStreaming.has(id) && id !== activeId) {
      completed.push(id);
    }
  }
  return completed;
}

/**
 * Build the set of currently-streaming IDs from an items list.
 */
export function getStreamingIds(items: StreamingItem[]): Set<string> {
  return new Set(items.filter((s) => s.streaming).map((s) => s.id));
}

function CompletedSessionToast({
  title,
  onGoToChat,
  onDismiss,
}: {
  title: string;
  onGoToChat: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex w-[360px] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-card-foreground">
        {title}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onGoToChat}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go to chat
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Watches the sessions list for streaming→complete transitions on non-active
 * sessions and fires a sonner toast so the user knows a background task finished.
 */
export function useBackgroundChatNotifications(
  sessions: SessionWithUnread[],
  activeSessionId: string | null,
  onNavigateToSession: (session: SessionWithUnread) => void,
) {
  // Track which session IDs were streaming on the previous render.
  const prevStreamingRef = useRef<Set<string>>(new Set());
  // Skip the very first render so we don't toast for sessions that were
  // already done before the component mounted.
  const hasMountedRef = useRef(false);
  // Keep a stable ref to the navigation callback so the effect closure
  // doesn't re-run when the callback identity changes.
  const navigateRef = useRef(onNavigateToSession);
  navigateRef.current = onNavigateToSession;

  useEffect(() => {
    const items = sessions.map((s) => ({
      id: s.id,
      streaming: s.hasStreaming,
    }));

    if (hasMountedRef.current) {
      const completedIds = detectCompletedSessions(
        prevStreamingRef.current,
        items,
        activeSessionId,
      );

      for (const sessionId of completedIds) {
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) continue;

        const title = session.title || "A session";

        toast.custom(
          (id) => (
            <CompletedSessionToast
              title={title}
              onGoToChat={() => {
                toast.dismiss(id);
                navigateRef.current(session);
              }}
              onDismiss={() => toast.dismiss(id)}
            />
          ),
          { position: "top-center", duration: 8000 },
        );
      }
    }

    hasMountedRef.current = true;
    prevStreamingRef.current = getStreamingIds(items);
  }, [sessions, activeSessionId]);
}
