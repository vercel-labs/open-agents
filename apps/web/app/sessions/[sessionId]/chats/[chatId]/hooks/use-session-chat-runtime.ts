"use client";

import { type UseChatHelpers, useChat } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type {
  WebAgentUIMessage,
  WebAgentWorkspaceStatusData,
} from "@/app/types";
import { AbortableChatTransport } from "@/lib/abortable-chat-transport";
import {
  abortChatInstanceTransport,
  getOrCreateChatInstance,
} from "@/lib/chat-instance-manager";
import { cleanupChatRouteOnUnmount } from "@/lib/chat-route-cleanup";
import {
  clearChatWorkspaceStatus,
  getChatWorkspaceStatusSnapshot,
  setChatWorkspaceStatus,
  subscribeChatWorkspaceStatus,
} from "@/lib/workspace-status-store";

const CHAT_UI_UPDATE_THROTTLE_MS = 75;

export type RetryChatStreamOptions = {
  auto?: boolean;
  strategy?: "hard" | "soft";
};

type UseSessionChatRuntimeParams = {
  sessionId: string;
  chatId: string;
  initialMessages: WebAgentUIMessage[];
  initialChatActiveStreamId: string | null | undefined;
  contextLimit: number | null;
};

type UseSessionChatRuntimeReturn = {
  chat: UseChatHelpers<WebAgentUIMessage>;
  stopChatStream: () => void;
  retryChatStream: (opts?: RetryChatStreamOptions) => void;
  workspaceStatus: WebAgentWorkspaceStatusData | null;
  clearWorkspaceStatus: () => void;
};

/**
 * Custom predicate for auto-submitting messages.
 * Unlike the default `lastAssistantMessageIsCompleteWithApprovalResponses`,
 * this also checks for tools waiting in `input-available` state (e.g., AskUserQuestion).
 */
function shouldAutoSubmit({
  messages,
}: {
  messages: WebAgentUIMessage[];
}): boolean {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "assistant") return false;

  // Find the last step-start to get tools from the current step only
  const lastStepStartIndex = lastMessage.parts.reduce(
    (lastIndex, part, index) =>
      part.type === "step-start" ? index : lastIndex,
    -1,
  );

  // Get tool invocations from the last step (non-provider-executed)
  const lastStepToolInvocations = lastMessage.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter((part) => !part.providerExecuted);

  // If no tool invocations, don't auto-submit
  if (lastStepToolInvocations.length === 0) return false;

  // Auto-submit only if ALL tools are in terminal state
  // Terminal states: output-available, output-error, approval-responded
  // NOT terminal: input-available (waiting for user input, e.g., AskUserQuestion)
  return lastStepToolInvocations.every(
    (part) =>
      part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "approval-responded",
  );
}

export function useSessionChatRuntime({
  sessionId,
  chatId,
  initialMessages,
  initialChatActiveStreamId,
  contextLimit,
}: UseSessionChatRuntimeParams): UseSessionChatRuntimeReturn {
  const contextLimitRef = useRef<number | null>(contextLimit);
  const workspaceStatus = useSyncExternalStore(
    useCallback(
      (listener) => subscribeChatWorkspaceStatus(chatId, listener),
      [chatId],
    ),
    useCallback(() => getChatWorkspaceStatusSnapshot(chatId), [chatId]),
    () => null,
  );

  useEffect(() => {
    contextLimitRef.current = contextLimit;
  }, [contextLimit]);

  const transport = useMemo(
    () =>
      new AbortableChatTransport({
        api: "/api/chat",
        body: () => {
          const requestContextLimit = contextLimitRef.current;
          return {
            sessionId,
            chatId,
            ...(requestContextLimit !== null
              ? {
                  context: {
                    contextLimit: requestContextLimit,
                  },
                }
              : {}),
          };
        },
        prepareReconnectToStreamRequest: ({ id }) => ({
          api: `/api/chat/${id}/stream`,
        }),
      }),
    [sessionId, chatId],
  );

  const { instance: chatInstance, alreadyExisted } = useMemo(
    () =>
      getOrCreateChatInstance(chatId, {
        id: chatId,
        transport,
        messages: initialMessages,
        onData: (dataPart) => {
          if (dataPart.type === "data-workspace-status") {
            setChatWorkspaceStatus(chatId, dataPart.data);
          }
        },
        sendAutomaticallyWhen: shouldAutoSubmit,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only create once per chatId; init values are only used at creation time
    [chatId],
  );

  // Track explicit user-initiated stops so auto-recovery doesn't immediately
  // reconnect to the still-running server stream (the main cause of the
  // "need to tap stop 3 times on iOS" bug).
  const userStoppedRef = useRef(false);
  const retryInFlightRef = useRef(false);

  const stopChatStream = useCallback(() => {
    userStoppedRef.current = true;

    // Send the current assistant message snapshot so the server can persist
    // mid-step output before cancelling the workflow.
    const lastMessage = chatInstance.messages[chatInstance.messages.length - 1];
    const assistantMessage =
      lastMessage?.role === "assistant" ? lastMessage : undefined;

    // We intentionally do not await this request so UI stop stays instant.
    void fetch(`/api/chat/${chatId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assistantMessage ? { assistantMessage } : {}),
    }).catch(() => {});

    void chatInstance.stop();
    abortChatInstanceTransport(chatId);
  }, [chatId, chatInstance]);

  // Compute resume only once on mount. If this tracks `chatInstance.status`
  // reactively, transient ready/submitted transitions during tool loops can
  // retrigger `resumeStream()` and replay recent chunks on top of the live
  // stream, causing visible jank.
  const shouldResumeOnMountRef = useRef(
    !!initialChatActiveStreamId &&
      (!alreadyExisted ||
        chatInstance.status === "ready" ||
        chatInstance.status === "error"),
  );

  const chat = useChat<WebAgentUIMessage>({
    chat: chatInstance,
    resume: shouldResumeOnMountRef.current,
    experimental_throttle: CHAT_UI_UPDATE_THROTTLE_MS,
  });

  /**
   * Clear a transient chat error (e.g. iOS "Load failed") and attempt to
   * resume the server-side stream if one is still active.
   *
   * When called from a manual "Retry" button we always want to reconnect, so
   * the stopped flag is reset.  When called from the automatic
   * visibility-change / online recovery handler, the flag is checked first so
   * that a user-initiated stop is respected and the stream is not silently
   * restarted.
   */
  const retryChatStream = useCallback(
    (opts?: RetryChatStreamOptions) => {
      const strategy = opts?.strategy ?? (opts?.auto ? "soft" : "hard");
      // If the user explicitly stopped the stream, don't auto-reconnect.
      // This prevents the "tap stop 3 times" loop on iOS where aborting the
      // transport causes a transient error that the auto-recovery immediately
      // reconnects.
      if (opts?.auto && userStoppedRef.current) {
        // Still clear the error so the UI doesn't show a stale error banner.
        chat.clearError();
        return;
      }
      if (retryInFlightRef.current) {
        return;
      }
      // Manual retry — reset the flag so the stream can proceed.
      userStoppedRef.current = false;
      retryInFlightRef.current = true;

      void (async () => {
        try {
          if (strategy === "hard") {
            // Tear down any stale local fetch before reconnecting.
            try {
              await chatInstance.stop();
            } catch {
              // Ignore stale local stop failures and still attempt reconnect.
            }
            abortChatInstanceTransport(chatId);
          }

          // Clear the error so the chat UI becomes visible again.
          chat.clearError();
          // If the server-side stream is still running, reconnect to it.
          await chat.resumeStream();
        } finally {
          retryInFlightRef.current = false;
        }
      })();
    },
    [chat, chatId, chatInstance],
  );

  // Reset the user-stopped flag when a new message is sent so that
  // auto-recovery works normally for the new stream.
  useEffect(() => {
    if (chat.status === "submitted") {
      userStoppedRef.current = false;
      clearChatWorkspaceStatus(chatId);
      return;
    }

    if (chat.status === "ready" || chat.status === "error") {
      clearChatWorkspaceStatus(chatId);
    }
  }, [chat.status, chatId]);

  useEffect(() => {
    if (!workspaceStatus) {
      return;
    }

    const lastMessage = chat.messages[chat.messages.length - 1];
    if (lastMessage?.role === "assistant" && lastMessage.parts.length > 0) {
      clearChatWorkspaceStatus(chatId);
    }
  }, [chat.messages, chatId, workspaceStatus]);

  const clearWorkspaceStatus = useCallback(() => {
    clearChatWorkspaceStatus(chatId);
  }, [chatId]);

  // Reactive resume fallback.
  //
  // `useChat({ resume })` only evaluates its argument once at mount, based on
  // SSR-time `initialChatActiveStreamId`. That leaves a gap: if the user
  // submits a message, navigates away before the server persists
  // `activeStreamId`, and comes back quickly, the page can SSR with
  // `activeStreamId = null` even though a workflow is (or is about to be)
  // running. The server-side fix — having the workflow self-register its
  // runId on step 1 — means the slot becomes populated shortly after the
  // workflow starts executing, but we need to discover that from the client.
  //
  // Strategy: if we mounted without a known active stream AND the
  // conversation ends with an unanswered user message, probe the resume
  // endpoint a few times with backoff. `GET /api/chat/:id/stream` returns
  // 204 when there's no active stream (cheap), so this is safe to call
  // speculatively.
  useEffect(() => {
    if (initialChatActiveStreamId) {
      // Normal resume path handles this; don't double-probe.
      return;
    }

    const lastMessage = chatInstance.messages[chatInstance.messages.length - 1];
    const endsWithUserMessage = lastMessage?.role === "user";
    if (!endsWithUserMessage) {
      // No unanswered user turn — no reason to expect a running stream.
      return;
    }

    let cancelled = false;
    // Backoff schedule tuned to cover the observed race window: the
    // workflow's first step claims activeStreamId shortly after start().
    // Total probe budget ~10s.
    const delaysMs = [0, 1_000, 2_500, 5_500, 10_000];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const attemptResume = async () => {
      if (cancelled) return;

      // Skip if a local send / resume is already in flight for this chat.
      const status = chatInstance.status;
      if (status !== "ready" && status !== "error") {
        return;
      }

      try {
        // GET /api/chat/:id/stream returns 204 when there's no active stream
        // (cheap no-op for the AI SDK) and 200 + stream bytes when one is
        // live. resumeStream handles both paths.
        await chat.resumeStream();
      } catch {
        // Transient failure (network, stale session, etc.) — let the next
        // scheduled attempt retry.
      }
    };

    const schedule = (index: number) => {
      if (cancelled || index >= delaysMs.length) return;
      timeoutId = setTimeout(async () => {
        await attemptResume();
        if (cancelled) return;
        // Keep probing until budget exhausted. Once resume attaches to a
        // live stream, subsequent attempts self-skip via the status guard.
        schedule(index + 1);
      }, delaysMs[index]);
    };

    schedule(0);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only probe; chatInstance/chat identities are stable per chatId
  }, [chatId, initialChatActiveStreamId]);

  // Cleanup: release per-route chat instances and abort local transport
  // connections so unmounted routes do not keep consuming client resources.
  //
  // Important: do NOT call chatInstance.stop() during route teardown.
  // stop() publishes a server stop signal; when users leave the page during
  // long-running tool/subagent work that would cancel generation and drop
  // persistence. We only stop explicitly via the UI stop action.
  useEffect(() => {
    return () => {
      cleanupChatRouteOnUnmount(chatId);
    };
  }, [chatId]);

  return {
    chat,
    stopChatStream,
    retryChatStream,
    workspaceStatus,
    clearWorkspaceStatus,
  };
}
