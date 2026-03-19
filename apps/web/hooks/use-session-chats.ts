"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { Chat } from "@/lib/db/schema";
import { fetcherNoStore } from "@/lib/swr";

export type SessionChatListItem = Chat & {
  hasUnread: boolean;
  isStreaming: boolean;
};

interface ChatsResponse {
  defaultModelId: string | null;
  chats: SessionChatListItem[];
}

interface SessionsResponse {
  sessions: Array<{
    id: string;
    hasUnread: boolean;
    hasStreaming: boolean;
    latestChatId: string | null;
  }>;
}

interface UseSessionChatsOptions {
  initialData?: ChatsResponse;
}

type CreateChatResult = {
  chat: Chat;
  persisted: Promise<Chat>;
};

type StreamingOverlay = {
  setAt: number;
  seenServerStreaming: boolean;
};

type ChatOptimisticOverlay = {
  title?: string;
  streaming?: StreamingOverlay;
};

// Keep the optimistic streaming badge briefly to cover client/server handoff,
// but clear quickly when the server never confirms streaming (fast turns,
// route switches, aborts) so the sidebar indicator doesn't linger.
const STREAMING_RACE_GRACE_MS = 4_000;
const OVERLAY_INACTIVE_TTL_MS = 5 * 60_000;
const STREAMING_REFRESH_INTERVAL_MS = 1_000;
const IDLE_REFRESH_INTERVAL_MS = 8_000;
const UNFOCUSED_REFRESH_INTERVAL_MS = 15_000;

// Persist optimistic chat UI state across chat route transitions.
const sessionChatOverlays = new Map<
  string,
  Map<string, ChatOptimisticOverlay>
>();
const overlayCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearOverlayCleanup(sessionId: string): void {
  const existingTimer = overlayCleanupTimers.get(sessionId);
  if (!existingTimer) {
    return;
  }

  clearTimeout(existingTimer);
  overlayCleanupTimers.delete(sessionId);
}

function scheduleOverlayCleanup(sessionId: string): void {
  clearOverlayCleanup(sessionId);
  const timer = setTimeout(() => {
    sessionChatOverlays.delete(sessionId);
    overlayCleanupTimers.delete(sessionId);
  }, OVERLAY_INACTIVE_TTL_MS);
  overlayCleanupTimers.set(sessionId, timer);
}

function getSessionOverlay(
  sessionId: string,
): Map<string, ChatOptimisticOverlay> {
  clearOverlayCleanup(sessionId);

  const existing = sessionChatOverlays.get(sessionId);
  if (existing) {
    return existing;
  }

  const created = new Map<string, ChatOptimisticOverlay>();
  sessionChatOverlays.set(sessionId, created);
  return created;
}

function isOverlayEmpty(overlay: ChatOptimisticOverlay): boolean {
  return !overlay.title && !overlay.streaming;
}

function overlaysEqual(
  left: ChatOptimisticOverlay | undefined,
  right: ChatOptimisticOverlay,
): boolean {
  return (
    left?.title === right.title &&
    left?.streaming?.setAt === right.streaming?.setAt &&
    left?.streaming?.seenServerStreaming ===
      right.streaming?.seenServerStreaming
  );
}

export type SessionSummary = {
  hasUnread: boolean;
  hasStreaming: boolean;
  latestChatId: string | null;
};

function areSessionSummariesEqual(
  left: SessionSummary,
  right: SessionSummary,
): boolean {
  return (
    left.hasUnread === right.hasUnread &&
    left.hasStreaming === right.hasStreaming &&
    left.latestChatId === right.latestChatId
  );
}

export function didSessionSummaryChange(
  previous: SessionSummary | null,
  next: SessionSummary,
): boolean {
  if (!previous) {
    return true;
  }

  return !areSessionSummariesEqual(previous, next);
}

export function deriveSessionSummaryFromChats(
  nextChats: SessionChatListItem[],
): SessionSummary {
  const latestChat = nextChats.length > 0 ? nextChats[0] : null;

  return {
    hasUnread: nextChats.some((chat) => chat.hasUnread),
    hasStreaming: nextChats.some((chat) => chat.isStreaming),
    latestChatId: latestChat ? latestChat.id : null,
  };
}

export function applySessionSummary(
  current: SessionsResponse | undefined,
  sessionId: string,
  summary: SessionSummary,
): SessionsResponse | undefined {
  if (!current) {
    return current;
  }

  let changed = false;
  const sessions = current.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    if (
      session.hasUnread === summary.hasUnread &&
      session.hasStreaming === summary.hasStreaming &&
      session.latestChatId === summary.latestChatId
    ) {
      return session;
    }

    changed = true;
    return {
      ...session,
      ...summary,
    };
  });

  return changed ? { ...current, sessions } : current;
}

export function applySessionSummaryFromChats(
  current: SessionsResponse | undefined,
  sessionId: string,
  nextChats: SessionChatListItem[],
): SessionsResponse | undefined {
  return applySessionSummary(
    current,
    sessionId,
    deriveSessionSummaryFromChats(nextChats),
  );
}

export function useSessionChats(
  sessionId: string | null,
  options?: UseSessionChatsOptions,
) {
  const [_overlayVersion, setOverlayVersion] = useState(0);
  const lastNonEmptyChatsRef = useRef<{
    sessionId: string | null;
    chats: SessionChatListItem[];
  }>({
    sessionId: null,
    chats: [],
  });
  const optimisticOverlay = useMemo(
    () => (sessionId ? getSessionOverlay(sessionId) : null),
    [sessionId],
  );
  const fallbackData = useMemo(() => {
    if (!sessionId || !options?.initialData) {
      return undefined;
    }

    const belongsToSession = options.initialData.chats.every(
      (chat) => chat.sessionId === sessionId,
    );

    return belongsToSession ? options.initialData : undefined;
  }, [sessionId, options?.initialData]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    clearOverlayCleanup(sessionId);
    return () => {
      scheduleOverlayCleanup(sessionId);
    };
  }, [sessionId]);

  const { data, error, isLoading, mutate } = useSWR<ChatsResponse>(
    sessionId ? `/api/sessions/${sessionId}/chats` : null,
    fetcherNoStore,
    {
      fallbackData,
      // We already render server-prefetched chats in the layout; avoid an
      // immediate mount revalidation clobbering hydration with stale client
      // cache/network responses. Focus/polling still keeps the list fresh.
      revalidateOnMount: fallbackData ? false : undefined,
      refreshInterval: (latestData) => {
        const hasStreamingChat =
          latestData?.chats.some((chat) => chat.isStreaming) ?? false;
        const hasOptimisticStreaming = optimisticOverlay
          ? Array.from(optimisticOverlay.values()).some(
              (overlay) => overlay.streaming,
            )
          : false;

        if (hasStreamingChat || hasOptimisticStreaming) {
          return STREAMING_REFRESH_INTERVAL_MS;
        }

        if (typeof document !== "undefined" && !document.hasFocus()) {
          return UNFOCUSED_REFRESH_INTERVAL_MS;
        }

        return IDLE_REFRESH_INTERVAL_MS;
      },
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    },
  );
  const { mutate: mutateSessionSummaries } = useSWRConfig();

  const updateOverlay = useCallback(
    (
      chatId: string,
      updater: (overlay: ChatOptimisticOverlay) => ChatOptimisticOverlay,
    ) => {
      if (!optimisticOverlay || !sessionId) {
        return;
      }

      const current = optimisticOverlay.get(chatId);
      const next = updater(current ? { ...current } : {});

      if (isOverlayEmpty(next)) {
        if (current) {
          optimisticOverlay.delete(chatId);
          if (optimisticOverlay.size === 0) {
            sessionChatOverlays.delete(sessionId);
            clearOverlayCleanup(sessionId);
          }
          setOverlayVersion((value) => value + 1);
        }
        return;
      }

      if (overlaysEqual(current, next)) {
        return;
      }

      if (!sessionChatOverlays.has(sessionId)) {
        sessionChatOverlays.set(sessionId, optimisticOverlay);
      }
      optimisticOverlay.set(chatId, next);
      setOverlayVersion((value) => value + 1);
    },
    [optimisticOverlay, sessionId],
  );

  const mergedChats = (data?.chats ?? []).map((chat) => {
    const overlay = optimisticOverlay?.get(chat.id);
    if (!overlay) {
      return chat;
    }

    let next = chat;
    if (overlay.title && chat.title === "New chat") {
      next = { ...next, title: overlay.title };
    }
    if (overlay.streaming && !chat.isStreaming) {
      next = { ...next, isStreaming: true };
    }
    return next;
  });

  useEffect(() => {
    if (!sessionId) {
      lastNonEmptyChatsRef.current = {
        sessionId: null,
        chats: [],
      };
      return;
    }

    if (mergedChats.length > 0) {
      lastNonEmptyChatsRef.current = {
        sessionId,
        chats: mergedChats,
      };
    }
  }, [sessionId, mergedChats]);

  const chats =
    mergedChats.length === 0 &&
    sessionId !== null &&
    lastNonEmptyChatsRef.current.sessionId === sessionId &&
    lastNonEmptyChatsRef.current.chats.length > 0
      ? lastNonEmptyChatsRef.current.chats
      : mergedChats;
  const summarySyncStateRef = useRef<{
    sessionId: string | null;
    summary: SessionSummary | null;
  }>({
    sessionId: null,
    summary: null,
  });

  const summaryHasUnread = chats.some((chat) => chat.hasUnread);
  const summaryHasStreaming = chats.some((chat) => chat.isStreaming);
  const summaryLatestChatId = chats[0]?.id ?? null;

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const summary: SessionSummary = {
      hasUnread: summaryHasUnread,
      hasStreaming: summaryHasStreaming,
      latestChatId: summaryLatestChatId,
    };

    const previousSummary =
      summarySyncStateRef.current.sessionId === sessionId
        ? summarySyncStateRef.current.summary
        : null;

    if (!didSessionSummaryChange(previousSummary, summary)) {
      return;
    }

    const wasStreamingInSession = previousSummary?.hasStreaming ?? false;

    summarySyncStateRef.current = {
      sessionId,
      summary,
    };

    void mutateSessionSummaries<SessionsResponse>(
      "/api/sessions",
      (current) => applySessionSummary(current, sessionId, summary),
      { revalidate: false },
    );

    if (wasStreamingInSession && !summary.hasStreaming) {
      void mutateSessionSummaries("/api/sessions");
    }
  }, [
    sessionId,
    summaryHasUnread,
    summaryHasStreaming,
    summaryLatestChatId,
    mutateSessionSummaries,
  ]);

  useEffect(() => {
    if (!data || !optimisticOverlay || !sessionId) {
      return;
    }

    let changed = false;
    const chatsById = new Map(data.chats.map((chat) => [chat.id, chat]));

    for (const [chatId, overlay] of optimisticOverlay) {
      const chat = chatsById.get(chatId);

      if (!chat) {
        optimisticOverlay.delete(chatId);
        changed = true;
        continue;
      }

      let nextOverlay = overlay;

      if (overlay.title && chat.title !== "New chat") {
        if (nextOverlay === overlay) {
          nextOverlay = { ...overlay };
        }
        delete nextOverlay.title;
      }

      if (overlay.streaming) {
        const streaming = nextOverlay.streaming ?? overlay.streaming;
        if (chat.isStreaming) {
          if (!streaming.seenServerStreaming) {
            if (nextOverlay === overlay) {
              nextOverlay = { ...overlay };
            }
            nextOverlay.streaming = {
              ...streaming,
              seenServerStreaming: true,
            };
          }
        } else {
          const ageMs = Date.now() - streaming.setAt;
          if (
            streaming.seenServerStreaming ||
            ageMs > STREAMING_RACE_GRACE_MS
          ) {
            if (nextOverlay === overlay) {
              nextOverlay = { ...overlay };
            }
            delete nextOverlay.streaming;
          }
        }
      }

      if (nextOverlay === overlay) {
        continue;
      }

      changed = true;
      if (isOverlayEmpty(nextOverlay)) {
        optimisticOverlay.delete(chatId);
      } else {
        optimisticOverlay.set(chatId, nextOverlay);
      }
    }

    if (!changed) {
      return;
    }

    if (optimisticOverlay.size === 0) {
      sessionChatOverlays.delete(sessionId);
      clearOverlayCleanup(sessionId);
    }
    setOverlayVersion((value) => value + 1);
  }, [data, optimisticOverlay, sessionId]);

  const toChatsResponse = useCallback(
    (
      current: ChatsResponse | undefined,
      nextChats: SessionChatListItem[],
    ): ChatsResponse => ({
      defaultModelId: current?.defaultModelId ?? data?.defaultModelId ?? null,
      chats: nextChats,
    }),
    [data?.defaultModelId],
  );

  const createChat = (): CreateChatResult => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    const now = new Date();
    const optimisticChat: Chat = {
      id: crypto.randomUUID(),
      sessionId,
      title: "New chat",
      modelId: data?.defaultModelId ?? null,
      activeStreamId: null,
      lastAssistantMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };

    void mutate(
      (current) =>
        toChatsResponse(current, [
          {
            ...optimisticChat,
            hasUnread: false,
            isStreaming: false,
          },
          ...(current?.chats ?? []).filter(
            (chat) => chat.id !== optimisticChat.id,
          ),
        ]),
      { revalidate: false },
    );

    const persisted = (async () => {
      const res = await fetch(`/api/sessions/${sessionId}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: optimisticChat.id }),
      });

      const responseData = (await res.json()) as {
        chat?: Chat;
        error?: string;
      };

      if (!res.ok || !responseData.chat) {
        await mutate(
          (current) =>
            toChatsResponse(
              current,
              (current?.chats ?? []).filter(
                (chat) => chat.id !== optimisticChat.id,
              ),
            ),
          { revalidate: false },
        );
        throw new Error(responseData.error ?? "Failed to create chat");
      }

      const createdChat = responseData.chat;

      await mutate(
        (current) =>
          toChatsResponse(current, [
            {
              ...createdChat,
              hasUnread: false,
              isStreaming: false,
            },
            ...(current?.chats ?? []).filter(
              (chat) => chat.id !== createdChat.id,
            ),
          ]),
        { revalidate: false },
      );

      return createdChat;
    })();

    return { chat: optimisticChat, persisted };
  };

  const renameChat = async (chatId: string, title: string) => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    const res = await fetch(`/api/sessions/${sessionId}/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    const responseData = (await res.json()) as { chat?: Chat; error?: string };
    if (!res.ok || !responseData.chat) {
      throw new Error(responseData.error ?? "Failed to rename chat");
    }

    const updatedChat = responseData.chat;
    await mutate(
      (current) =>
        toChatsResponse(
          current,
          (current?.chats ?? []).map((chat) =>
            chat.id === chatId ? { ...chat, ...updatedChat } : chat,
          ),
        ),
      { revalidate: false },
    );

    return updatedChat;
  };

  const deleteChat = async (chatId: string) => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    const res = await fetch(`/api/sessions/${sessionId}/chats/${chatId}`, {
      method: "DELETE",
    });

    const responseData = (await res.json()) as {
      success?: boolean;
      error?: string;
    };

    if (!res.ok || !responseData.success) {
      throw new Error(responseData.error ?? "Failed to delete chat");
    }

    await mutate(
      (current) =>
        toChatsResponse(
          current,
          (current?.chats ?? []).filter((chat) => chat.id !== chatId),
        ),
      { revalidate: false },
    );
  };

  const markChatRead = async (chatId: string) => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    const res = await fetch(`/api/sessions/${sessionId}/chats/${chatId}/read`, {
      method: "POST",
    });

    const responseData = (await res.json()) as {
      success?: boolean;
      error?: string;
    };

    if (!res.ok || !responseData.success) {
      throw new Error(responseData.error ?? "Failed to mark chat as read");
    }

    await mutate(
      (current) =>
        toChatsResponse(
          current,
          (current?.chats ?? []).map((chat) =>
            chat.id === chatId ? { ...chat, hasUnread: false } : chat,
          ),
        ),
      { revalidate: false },
    );
  };

  const setChatStreaming = async (chatId: string, isStreaming: boolean) => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    if (isStreaming) {
      updateOverlay(chatId, (overlay) => ({
        ...overlay,
        streaming: {
          setAt: Date.now(),
          seenServerStreaming: false,
        },
      }));
    } else {
      updateOverlay(chatId, (overlay) => {
        const next = { ...overlay };
        delete next.streaming;
        return next;
      });
    }

    void mutateSessionSummaries<SessionsResponse>(
      "/api/sessions",
      (current) => {
        if (!current) {
          return current;
        }

        let changed = false;
        const sessions = current.sessions.map((session) => {
          if (session.id !== sessionId) {
            return session;
          }

          if (
            session.hasStreaming === isStreaming &&
            session.latestChatId === chatId
          ) {
            return session;
          }

          changed = true;
          return {
            ...session,
            hasStreaming: isStreaming,
            latestChatId: chatId,
          };
        });

        return changed ? { ...current, sessions } : current;
      },
      { revalidate: false },
    );

    await mutate(
      (current) => {
        if (!current) {
          return current;
        }

        return toChatsResponse(
          current,
          current.chats.map((chat) =>
            chat.id === chatId ? { ...chat, isStreaming } : chat,
          ),
        );
      },
      { revalidate: false },
    );
  };

  const setChatTitle = (chatId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    updateOverlay(chatId, (overlay) => ({
      ...overlay,
      title: trimmedTitle,
    }));
  };

  const clearChatTitle = (chatId: string) => {
    updateOverlay(chatId, (overlay) => {
      const next = { ...overlay };
      delete next.title;
      return next;
    });
  };

  return {
    chats,
    loading: isLoading,
    error,
    createChat,
    renameChat,
    deleteChat,
    markChatRead,
    setChatStreaming,
    setChatTitle,
    clearChatTitle,
    refreshChats: mutate,
  };
}
