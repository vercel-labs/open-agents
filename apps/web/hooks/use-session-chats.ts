"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

export type SessionChatListItem = Chat & {
  hasUnread: boolean;
  isStreaming: boolean;
};

interface ChatsResponse {
  chats: SessionChatListItem[];
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

const STREAMING_RACE_GRACE_MS = 12_000;

// Persist optimistic chat UI state across chat route transitions.
const sessionChatOverlays = new Map<
  string,
  Map<string, ChatOptimisticOverlay>
>();

function getSessionOverlay(
  sessionId: string,
): Map<string, ChatOptimisticOverlay> {
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

export function useSessionChats(sessionId: string | null) {
  const [overlayVersion, setOverlayVersion] = useState(0);
  const optimisticOverlay = useMemo(
    () => (sessionId ? getSessionOverlay(sessionId) : null),
    [sessionId],
  );

  const { data, error, isLoading, mutate } = useSWR<ChatsResponse>(
    sessionId ? `/api/sessions/${sessionId}/chats` : null,
    fetcher,
    {
      refreshInterval: (latestData) =>
        latestData?.chats.some((chat) => chat.isStreaming) ||
        (optimisticOverlay
          ? Array.from(optimisticOverlay.values()).some(
              (overlay) => overlay.streaming,
            )
          : false)
          ? 1_000
          : 5_000,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    },
  );

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
          }
          setOverlayVersion((value) => value + 1);
        }
        return;
      }

      if (overlaysEqual(current, next)) {
        return;
      }

      optimisticOverlay.set(chatId, next);
      setOverlayVersion((value) => value + 1);
    },
    [optimisticOverlay, sessionId],
  );

  const chats = useMemo(
    () =>
      (data?.chats ?? []).map((chat) => {
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
      }),
    [data, optimisticOverlay, overlayVersion],
  );

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
    }
    setOverlayVersion((value) => value + 1);
  }, [data, optimisticOverlay, sessionId]);

  const createChat = (): CreateChatResult => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    const now = new Date();
    const optimisticChat: Chat = {
      id: crypto.randomUUID(),
      sessionId,
      title: "New chat",
      modelId: data?.chats[0]?.modelId ?? null,
      activeStreamId: null,
      lastAssistantMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };

    void mutate(
      (current) => ({
        chats: [
          {
            ...optimisticChat,
            hasUnread: false,
            isStreaming: false,
          },
          ...(current?.chats ?? []).filter(
            (chat) => chat.id !== optimisticChat.id,
          ),
        ],
      }),
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
          (current) => ({
            chats: (current?.chats ?? []).filter(
              (chat) => chat.id !== optimisticChat.id,
            ),
          }),
          { revalidate: false },
        );
        throw new Error(responseData.error ?? "Failed to create chat");
      }

      const createdChat = responseData.chat;

      await mutate(
        (current) => ({
          chats: [
            {
              ...createdChat,
              hasUnread: false,
              isStreaming: false,
            },
            ...(current?.chats ?? []).filter(
              (chat) => chat.id !== createdChat.id,
            ),
          ],
        }),
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
      (current) => ({
        chats: (current?.chats ?? []).map((chat) =>
          chat.id === chatId ? { ...chat, ...updatedChat } : chat,
        ),
      }),
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
      (current) => ({
        chats: (current?.chats ?? []).filter((chat) => chat.id !== chatId),
      }),
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
      (current) => ({
        chats: (current?.chats ?? []).map((chat) =>
          chat.id === chatId ? { ...chat, hasUnread: false } : chat,
        ),
      }),
      { revalidate: false },
    );
  };

  const setChatStreaming = async (chatId: string, isStreaming: boolean) => {
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

    await mutate(
      (current) => {
        if (!current) {
          return current;
        }

        return {
          chats: current.chats.map((chat) =>
            chat.id === chatId ? { ...chat, isStreaming } : chat,
          ),
        };
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
