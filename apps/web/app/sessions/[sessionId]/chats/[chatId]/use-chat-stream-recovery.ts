import { useCallback, useEffect, useRef } from "react";
import {
  canAttemptAutoRecovery,
  CHAT_STREAM_RECOVERY_COOLDOWN_MS,
  CHAT_STREAM_STALL_THRESHOLD_MS,
  shouldResetAutoRecoveryWindow,
  type ChatStreamStatus,
} from "./chat-stream-recovery-policy";

type RetryChatStream = (opts?: { auto?: boolean }) => void;

type UseChatStreamRecoveryArgs = {
  sessionId: string;
  chatId: string;
  status: ChatStreamStatus;
  isChatInFlight: boolean;
  hasAssistantRenderableContent: boolean;
  retryChatStream: RetryChatStream;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatStreamingProbeResponse(value: unknown): value is {
  chats: { id: string; isStreaming: boolean }[];
} {
  if (!isObjectRecord(value)) {
    return false;
  }

  const chats = value["chats"];
  if (!Array.isArray(chats)) {
    return false;
  }

  return chats.every(
    (chat) =>
      isObjectRecord(chat) &&
      typeof chat["id"] === "string" &&
      typeof chat["isStreaming"] === "boolean",
  );
}

export function useChatStreamRecovery({
  sessionId,
  chatId,
  status,
  isChatInFlight,
  hasAssistantRenderableContent,
  retryChatStream,
}: UseChatStreamRecoveryArgs): void {
  const inFlightStartedAtRef = useRef<number | null>(null);
  const lastStreamRecoveryAtRef = useRef(0);
  const streamRecoveryProbeInFlightRef = useRef(false);
  const previousStatusRef = useRef<ChatStreamStatus | null>(null);

  useEffect(() => {
    if (
      shouldResetAutoRecoveryWindow({
        previousStatus: previousStatusRef.current,
        nextStatus: status,
      })
    ) {
      lastStreamRecoveryAtRef.current = 0;
      streamRecoveryProbeInFlightRef.current = false;
    }

    previousStatusRef.current = status;
  }, [status]);

  const maybeRecoverStreamRef = useRef<() => void>(() => {});
  maybeRecoverStreamRef.current = () => {
    const now = Date.now();

    if (
      !canAttemptAutoRecovery({
        nowMs: now,
        lastAttemptAtMs: lastStreamRecoveryAtRef.current,
        cooldownMs: CHAT_STREAM_RECOVERY_COOLDOWN_MS,
        isAttemptInFlight: streamRecoveryProbeInFlightRef.current,
      })
    ) {
      return;
    }

    if (status === "error") {
      lastStreamRecoveryAtRef.current = now;
      retryChatStream({ auto: true });
      return;
    }

    // Only run "silent stream" recovery while still in submitted state.
    // During active streaming, reconnecting can replay recent chunks and cause
    // visible jank even when the connection is healthy.
    if (status !== "submitted" || hasAssistantRenderableContent) {
      return;
    }

    const startedAt = inFlightStartedAtRef.current;
    if (
      startedAt === null ||
      now - startedAt < CHAT_STREAM_STALL_THRESHOLD_MS ||
      streamRecoveryProbeInFlightRef.current
    ) {
      return;
    }

    streamRecoveryProbeInFlightRef.current = true;
    lastStreamRecoveryAtRef.current = now;

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

        retryChatStream({ auto: true });
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
    streamRecoveryProbeInFlightRef.current = false;
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
    if (!isChatInFlight || hasAssistantRenderableContent) {
      return;
    }
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const startedAt = inFlightStartedAtRef.current;
    const elapsed = startedAt === null ? 0 : Date.now() - startedAt;
    const waitMs = Math.max(0, CHAT_STREAM_STALL_THRESHOLD_MS - elapsed);
    const timeout = setTimeout(() => {
      maybeRecoverStream();
    }, waitMs);

    return () => clearTimeout(timeout);
  }, [isChatInFlight, hasAssistantRenderableContent, maybeRecoverStream]);
}
