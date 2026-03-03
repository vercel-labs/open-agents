"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SessionChatListItem } from "@/hooks/use-session-chats";

/**
 * Watches the chat list for streaming→complete transitions on non-active chats
 * and fires a sonner toast so the user knows a background chat finished.
 */
export function useBackgroundChatNotifications(
  chats: SessionChatListItem[],
  activeChatId: string | null,
  onNavigateToChat: (chatId: string) => void,
) {
  // Track which chat IDs were streaming on the previous render.
  const prevStreamingRef = useRef<Set<string>>(new Set());
  // Skip the very first render so we don't toast for chats that were already
  // done before the component mounted.
  const hasMountedRef = useRef(false);

  useEffect(() => {
    const currentlyStreaming = new Set(
      chats.filter((c) => c.isStreaming).map((c) => c.id),
    );

    if (hasMountedRef.current) {
      const prevStreaming = prevStreamingRef.current;

      for (const chatId of prevStreaming) {
        // Chat was streaming last tick but is no longer streaming
        if (!currentlyStreaming.has(chatId) && chatId !== activeChatId) {
          const chat = chats.find((c) => c.id === chatId);
          const title = chat?.title || "A chat";

          toast(`Agent finished in: ${title}`, {
            position: "top-center",
            duration: 8000,
            action: {
              label: "Go to chat",
              onClick: () => onNavigateToChat(chatId),
            },
          });
        }
      }
    }

    hasMountedRef.current = true;
    prevStreamingRef.current = currentlyStreaming;
  }, [chats, activeChatId, onNavigateToChat]);
}
