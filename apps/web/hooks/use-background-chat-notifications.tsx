"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SessionWithUnread } from "@/hooks/use-sessions";

type StreamingItem = { id: string; streaming: boolean };
type BrowserNotificationHandler = (session: SessionWithUnread) => void;

const FINISHED_CHAT_SOUND_PATH = "/Submarine.wav";
const RECENTLY_FOREGROUNDED_WINDOW_MS = 5_000;

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

export function wasPageRecentlyForegrounded(
  lastBackgroundedAt: number,
  lastForegroundedAt: number,
  now: number,
): boolean {
  return (
    lastBackgroundedAt > 0 &&
    lastForegroundedAt >= lastBackgroundedAt &&
    now - lastForegroundedAt <= RECENTLY_FOREGROUNDED_WINDOW_MS
  );
}

function isPageBackgrounded(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.visibilityState !== "visible" || !document.hasFocus();
}

export function shouldSendBrowserNotification(
  canSendBrowserNotifications: boolean,
  onBrowserNotification?: BrowserNotificationHandler,
): onBrowserNotification is BrowserNotificationHandler {
  return (
    canSendBrowserNotifications && typeof onBrowserNotification === "function"
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
  canSendBrowserNotifications = false,
  onBrowserNotification?: BrowserNotificationHandler,
) {
  // Track which session IDs were streaming on the previous render.
  const prevStreamingRef = useRef<Set<string>>(new Set());
  // Skip the very first render so we don't toast for sessions that were
  // already done before the component mounted.
  const hasMountedRef = useRef(false);
  const lastBackgroundedAtRef = useRef(0);
  const lastForegroundedAtRef = useRef(0);
  // Keep stable refs to callbacks/options so the effect closure doesn't re-run
  // when callback identities or browser-notification state change.
  const navigateRef = useRef(onNavigateToSession);
  const browserNotificationRef = useRef(onBrowserNotification);
  const canSendBrowserNotificationsRef = useRef(canSendBrowserNotifications);
  navigateRef.current = onNavigateToSession;
  browserNotificationRef.current = onBrowserNotification;
  canSendBrowserNotificationsRef.current = canSendBrowserNotifications;

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const markBackgrounded = () => {
      if (isPageBackgrounded()) {
        lastBackgroundedAtRef.current = Date.now();
      }
    };

    const markForegrounded = () => {
      if (!isPageBackgrounded()) {
        lastForegroundedAtRef.current = Date.now();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markForegrounded();
        return;
      }

      markBackgrounded();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", markBackgrounded);
    window.addEventListener("focus", markForegrounded);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", markBackgrounded);
      window.removeEventListener("focus", markForegrounded);
    };
  }, []);

  useEffect(() => {
    const items = sessions.map((s) => ({
      id: s.id,
      streaming: s.hasStreaming,
    }));

    if (hasMountedRef.current) {
      const shouldSurfaceBrowserNotifications =
        isPageBackgrounded() ||
        wasPageRecentlyForegrounded(
          lastBackgroundedAtRef.current,
          lastForegroundedAtRef.current,
          Date.now(),
        );
      const completedIds = detectCompletedSessions(
        prevStreamingRef.current,
        items,
        shouldSurfaceBrowserNotifications ? null : activeSessionId,
      );

      let hasCompleted = false;

      for (const sessionId of completedIds) {
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) continue;

        hasCompleted = true;
        const title = session.title || "A session";
        const navigateToSession = () => navigateRef.current(session);

        toast("Agent finished", {
          description: title,
          position: "top-center",
          duration: 8000,
          action: {
            label: "Go to chat",
            onClick: navigateToSession,
          },
        });

        const browserNotification =
          shouldSurfaceBrowserNotifications && browserNotificationRef.current
            ? browserNotificationRef.current
            : undefined;
        if (
          shouldSendBrowserNotification(
            canSendBrowserNotificationsRef.current,
            browserNotification,
          )
        ) {
          browserNotification(session);
        }
      }

      if (hasCompleted) {
        playFinishedChatSound();
      }
    }

    hasMountedRef.current = true;
    prevStreamingRef.current = getStreamingIds(items);
  }, [sessions, activeSessionId]);
}
