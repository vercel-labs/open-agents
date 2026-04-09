"use client";

import { createContext, useContext } from "react";
import type { SessionChatListItem } from "@/hooks/use-session-chats";
import type { Chat } from "@/lib/db/schema";

type CreateChatResult = {
  chat: Chat;
  persisted: Promise<Chat>;
};

type SessionLayoutContextValue = {
  session: {
    title: string;
    repoName: string | null;
    repoOwner: string | null;
    cloneUrl: string | null;
    branch: string | null;
    status: string;
    prNumber: number | null;
    prStatus: string | null;
    linesAdded: number | null;
    linesRemoved: number | null;
  };
  chats: SessionChatListItem[];
  chatsLoading: boolean;
  createChat: () => CreateChatResult;
  switchChat: (chatId: string) => void;
  deleteChat: (chatId: string) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<unknown>;
};

export const SessionLayoutContext = createContext<
  SessionLayoutContextValue | undefined
>(undefined);

export function useSessionLayout() {
  const context = useContext(SessionLayoutContext);
  if (!context) {
    throw new Error(
      "useSessionLayout must be used within a SessionLayoutShell",
    );
  }
  return context;
}
