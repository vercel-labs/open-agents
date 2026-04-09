"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SessionWithUnread } from "@/hooks/use-sessions";

type StreamingItem = { id: string; streaming: boolean };

const FINISHED_CHAT_SOUND_PATH = "/Submarine.wav";

function playFinishedChatSound() {
  if (typeof window === "undefined" || typeof window.Audio === "undefined") {
    return;
  }

  const audio = new window.Audio(FINISHED_CHAT_SOUND_PATH);
  audio.play().catch(() => undefined);
}

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

/**
 * Watches the sessions list for streaming→complete transitions on non-active
 * sessions and fires a sonner toast so the user knows a background task finished.
 */
export function useBackgroundChatNotifications(
  sessions: SessionWithUnread[],
  activeSessionId: string | null,
  onNavigateToSession: (session: SessionWithUnread) => void,
  options?: { alertsEnabled?: boolean; alertSoundEnabled?: boolean },
) {
  const alertsEnabled = options?.alertsEnabled ?? true;
  const alertSoundEnabled = options?.alertSoundEnabled ?? true;
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

      let hasCompleted = false;

      for (const sessionId of completedIds) {
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) continue;

        hasCompleted = true;

        if (alertsEnabled) {
          const title = session.title || "A session";

          toast("Agent finished", {
            description: title,
            position: "top-center",
            duration: 8000,
            action: {
              label: "Go to chat",
              onClick: () => navigateRef.current(session),
            },
          });
        }
      }

      if (hasCompleted && alertsEnabled && alertSoundEnabled) {
        playFinishedChatSound();
      }
    }

    hasMountedRef.current = true;
    prevStreamingRef.current = getStreamingIds(items);
  }, [sessions, activeSessionId, alertsEnabled, alertSoundEnabled]);
}
