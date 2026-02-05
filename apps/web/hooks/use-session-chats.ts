"use client";

import useSWR from "swr";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/swr";

interface ChatsResponse {
  chats: Chat[];
}

export function useSessionChats(sessionId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ChatsResponse>(
    sessionId ? `/api/sessions/${sessionId}/chats` : null,
    fetcher,
  );

  const chats = data?.chats ?? [];

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
        chats: [responseData.chat!, ...(current?.chats ?? [])],
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
          chat.id === chatId ? updatedChat : chat,
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

  return {
    chats,
    loading: isLoading,
    error,
    createChat,
    renameChat,
    deleteChat,
    refreshChats: mutate,
  };
}
