"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SessionWithUnread } from "@/hooks/use-sessions";

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
    const currentlyStreaming = new Set(
      sessions.filter((s) => s.hasStreaming).map((s) => s.id),
    );

    if (hasMountedRef.current) {
      const prevStreaming = prevStreamingRef.current;

      for (const sessionId of prevStreaming) {
        // Session was streaming last tick but is no longer streaming,
        // and it is not the session the user is currently viewing.
        if (
          !currentlyStreaming.has(sessionId) &&
          sessionId !== activeSessionId
        ) {
          const session = sessions.find((s) => s.id === sessionId);
          if (!session) continue;

          const title = session.title || "A session";

          toast(`Agent finished: ${title}`, {
            position: "top-center",
            duration: 8000,
            action: {
              label: "Go to chat",
              onClick: () => navigateRef.current(session),
            },
          });
        }
      }
    }

    hasMountedRef.current = true;
    prevStreamingRef.current = currentlyStreaming;
  }, [sessions, activeSessionId]);
}
