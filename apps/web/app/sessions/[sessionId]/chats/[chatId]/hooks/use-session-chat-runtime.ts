"use client";

import { type UseChatHelpers, useChat } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WebAgentUIMessage } from "@/app/types";
import { AbortableChatTransport } from "@/lib/abortable-chat-transport";
import {
  abortChatInstanceTransport,
  getOrCreateChatInstance,
} from "@/lib/chat-instance-manager";
import { cleanupChatRouteOnUnmount } from "@/lib/chat-route-cleanup";

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
        sendAutomaticallyWhen: shouldAutoSubmit,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only create once per chatId; init values are only used at creation time
    [chatId],
  );

  // Track explicit user-initiated stops so auto-recovery doesn't immediately
  // reconnect to the still-running server stream (the main cause of the
  // "need to tap stop 3 times on iOS" bug).
  const userStoppedRef = useRef(false);

  const stopChatStream = useCallback(() => {
    userStoppedRef.current = true;
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
      const strategy = opts?.strategy ?? "hard";
      // If the user explicitly stopped the stream, don't auto-reconnect.
      // This prevents the "tap stop 3 times" loop on iOS where aborting the
      // transport causes a transient error that the auto-recovery immediately
      // reconnects.
      if (opts?.auto && userStoppedRef.current) {
        // Still clear the error so the UI doesn't show a stale error banner.
        chat.clearError();
        return;
      }
      // Manual retry — reset the flag so the stream can proceed.
      userStoppedRef.current = false;
      if (strategy === "hard") {
        // Tear down any stale local fetch before reconnecting.
        void chatInstance.stop();
        abortChatInstanceTransport(chatId);
      }
      // Clear the error so the chat UI becomes visible again.
      chat.clearError();
      // If the server-side stream is still running, reconnect to it.
      void chat.resumeStream();
    },
    [chat, chatId, chatInstance],
  );

  // Reset the user-stopped flag when a new message is sent so that
  // auto-recovery works normally for the new stream.
  useEffect(() => {
    if (chat.status === "submitted") {
      userStoppedRef.current = false;
    }
  }, [chat.status]);

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
  };
}
