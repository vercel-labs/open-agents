"use client";

import { useEffect, useState } from "react";
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

export function useSessionChats(sessionId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ChatsResponse>(
    sessionId ? `/api/sessions/${sessionId}/chats` : null,
    fetcher,
    {
      refreshInterval: (latestData) =>
        latestData?.chats.some((chat) => chat.isStreaming) ? 1_000 : 5_000,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    },
  );

  const [optimisticTitles, setOptimisticTitles] = useState<
    Record<string, string>
  >({});

  const chats = (data?.chats ?? []).map((chat) => {
    const optimisticTitle = optimisticTitles[chat.id];
    if (!optimisticTitle || chat.title !== "New chat") {
      return chat;
    }
    return { ...chat, title: optimisticTitle };
  });

  useEffect(() => {
    if (!data) return;
    setOptimisticTitles((current) => {
      let next = current;
      let changed = false;

      for (const chat of data.chats) {
        if (!current[chat.id]) continue;
        if (chat.title !== "New chat") {
          if (next === current) {
            next = { ...current };
          }
          delete next[chat.id];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [data]);

  const createChat = async () => {
    if (!sessionId) {
      throw new Error("Missing sessionId");
    }

    const res = await fetch(`/api/sessions/${sessionId}/chats`, {
      method: "POST",
    });

    const responseData = (await res.json()) as { chat?: Chat; error?: string };

    if (!res.ok || !responseData.chat) {
      throw new Error(responseData.error ?? "Failed to create chat");
    }

    await mutate(
      (current) => ({
        chats: [
          {
            ...responseData.chat!,
            hasUnread: false,
            isStreaming: false,
          },
          ...(current?.chats ?? []),
        ],
      }),
      { revalidate: false },
    );

    return responseData.chat;
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

  const setChatTitle = async (chatId: string, title: string) => {
    setOptimisticTitles((current) => ({ ...current, [chatId]: title }));
  };

  const clearChatTitle = async (chatId: string) => {
    setOptimisticTitles((current) => {
      if (!current[chatId]) {
        return current;
      }

      const next = { ...current };
      delete next[chatId];
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
