"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ChatUiStatus } from "@/lib/chat-streaming-state";
import {
  getStreamRecoveryDecision,
  getStreamRecoveryDelayMs,
  isChatStreamingProbeResponse,
  shouldScheduleStallRecovery,
} from "../stream-recovery-policy";

type RetryChatStream = (opts?: {
  auto?: boolean;
  strategy?: "hard" | "soft";
}) => void;

type UseStreamRecoveryParams = {
  sessionId: string;
  chatId: string;
  status: ChatUiStatus;
  isChatInFlight: boolean;
  hasAssistantRenderableContent: boolean;
  retryChatStream: RetryChatStream;
};

export function useStreamRecovery({
  sessionId,
  chatId,
  status,
  isChatInFlight,
  hasAssistantRenderableContent,
  retryChatStream,
}: UseStreamRecoveryParams): void {
  const inFlightStartedAtRef = useRef<number | null>(null);
  const lastStreamRecoveryAtRef = useRef(0);
  const streamRecoveryProbeInFlightRef = useRef(false);

  // Keep the recovery logic in a ref so event-listener effects never
  // churn during streaming. The ref is updated on every render (cheap) while
  // the stable wrapper below keeps a constant identity for effects.
  const maybeRecoverStreamRef = useRef(() => {});
  maybeRecoverStreamRef.current = () => {
    const now = Date.now();
    const recoveryDecision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: lastStreamRecoveryAtRef.current,
      status,
      hasAssistantRenderableContent,
      inFlightStartedAt: inFlightStartedAtRef.current,
      isProbeInFlight: streamRecoveryProbeInFlightRef.current,
    });

    if (recoveryDecision === "none") {
      return;
    }

    lastStreamRecoveryAtRef.current = now;

    if (recoveryDecision === "retry-error") {
      retryChatStream({ auto: true });
      return;
    }

    streamRecoveryProbeInFlightRef.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/chats`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload: unknown = await response.json();
        if (!isChatStreamingProbeResponse(payload)) {
          return;
        }

        const serverChat = payload.chats.find((chat) => chat.id === chatId);
        if (!serverChat?.isStreaming) {
          return;
        }

        retryChatStream({ auto: true, strategy: "soft" });
      } catch {
        // Ignore transient probe failures and try again on next interval.
      } finally {
        streamRecoveryProbeInFlightRef.current = false;
      }
    })();
  };

  // Stable identity wrapper – safe to use in effect dependency arrays without
  // causing teardown/re-register cycles.
  const maybeRecoverStream = useCallback(() => {
    maybeRecoverStreamRef.current();
  }, []);

  useEffect(() => {
    if (isChatInFlight) {
      if (inFlightStartedAtRef.current === null) {
        inFlightStartedAtRef.current = Date.now();
      }
      return;
    }

    inFlightStartedAtRef.current = null;
  }, [isChatInFlight, chatId]);

  // Recover from transient connection drops when the tab regains visibility
  // or the network comes back. The listeners are registered once because
  // maybeRecoverStream has a stable identity (delegates to a ref internally).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        maybeRecoverStream();
      }
    };

    const onFocus = () => {
      maybeRecoverStream();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", maybeRecoverStream);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", maybeRecoverStream);
    };
  }, [maybeRecoverStream]);

  useEffect(() => {
    const isDocumentVisible =
      typeof document === "undefined" || document.visibilityState === "visible";

    if (
      !shouldScheduleStallRecovery({
        isChatInFlight,
        hasAssistantRenderableContent,
        isDocumentVisible,
      })
    ) {
      return;
    }

    const waitMs = getStreamRecoveryDelayMs({
      now: Date.now(),
      inFlightStartedAt: inFlightStartedAtRef.current,
    });
    const timeout = setTimeout(() => {
      maybeRecoverStream();
    }, waitMs);

    return () => clearTimeout(timeout);
  }, [isChatInFlight, hasAssistantRenderableContent, maybeRecoverStream]);
}
