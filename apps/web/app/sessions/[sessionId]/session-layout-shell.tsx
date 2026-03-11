"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import {
  type SessionChatListItem,
  useSessionChats,
} from "@/hooks/use-session-chats";
import type { Session } from "@/lib/db/schema";
import { SessionLayoutContext } from "./session-layout-context";

type SessionLayoutShellProps = {
  session: Session;
  initialChatsData?: {
    defaultModelId: string | null;
    chats: SessionChatListItem[];
  };
  children: ReactNode;
};

export function SessionLayoutShell({
  session: initialSession,
  initialChatsData,
  children,
}: SessionLayoutShellProps) {
  const router = useRouter();

  const sessionId = initialSession.id;

  const {
    chats,
    loading: chatsLoading,
    createChat,
  } = useSessionChats(sessionId, { initialData: initialChatsData });

  const switchChat = useCallback(
    (chatId: string) => {
      router.push(`/sessions/${sessionId}/chats/${chatId}`);
    },
    [router, sessionId],
  );

  const layoutContext = useMemo(
    () => ({
      session: {
        title: initialSession.title,
        repoName: initialSession.repoName,
        repoOwner: initialSession.repoOwner,
        cloneUrl: initialSession.cloneUrl,
        branch: initialSession.branch,
        status: initialSession.status,
        prNumber: initialSession.prNumber,
        linesAdded: initialSession.linesAdded,
        linesRemoved: initialSession.linesRemoved,
      },
      chats,
      chatsLoading,
      createChat,
      switchChat,
    }),
    [initialSession, chats, chatsLoading, createChat, switchChat],
  );

  return (
    <SessionLayoutContext.Provider value={layoutContext}>
      {children}
    </SessionLayoutContext.Provider>
  );
}
