"use client";

import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import {
  type SessionChatListItem,
  useSessionChats,
} from "@/hooks/use-session-chats";
import type { Session } from "@/lib/db/schema";
import {
  GitPanelProvider,
  useGitPanel,
} from "./chats/[chatId]/git-panel-context";
import { SessionHeader } from "./chats/[chatId]/session-header";
import { ChatTabs } from "./chats/[chatId]/chat-tabs";
import { SessionLayoutContext } from "./session-layout-context";

type SessionLayoutShellProps = {
  session: Session;
  initialChatsData?: {
    defaultModelId: string | null;
    chats: SessionChatListItem[];
  };
  children: ReactNode;
};

/**
 * Inner component that reads panelContent from context and renders
 * the horizontal split: left column (header + tabs + page) | right panel.
 */
function SessionLayoutInner({
  activeChatId,
  children,
}: {
  activeChatId: string;
  children: ReactNode;
}) {
  const { panelPortalRef, gitPanelOpen, setGitPanelOpen } = useGitPanel();

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Left column: header + tabs + page content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <SessionHeader />
        {activeChatId && <ChatTabs activeChatId={activeChatId} />}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      {/* Mobile backdrop for outside-click dismissal */}
      {gitPanelOpen && (
        <button
          type="button"
          aria-label="Close right sidebar"
          className="absolute inset-0 z-20 bg-background/20 sm:hidden"
          onClick={() => setGitPanelOpen(false)}
        />
      )}

      {/* Portal target for the git panel — slideover on mobile, sidebar on larger screens */}
      <div
        ref={panelPortalRef}
        className={`absolute right-0 top-0 z-30 flex h-full w-72 flex-col overflow-hidden border-l border-border bg-background shadow-lg transition-transform duration-200 ease-in-out sm:relative sm:right-auto sm:top-auto sm:z-0 sm:shrink-0 sm:translate-x-0 sm:shadow-none sm:transition-[width] ${
          gitPanelOpen
            ? "translate-x-0 sm:w-72 sm:border-l xl:w-80"
            : "translate-x-full sm:w-0 sm:border-l-0"
        }`}
      />
    </div>
  );
}

export function SessionLayoutShell({
  session: initialSession,
  initialChatsData,
  children,
}: SessionLayoutShellProps) {
  const router = useRouter();
  const params = useParams<{ chatId?: string }>();
  const activeChatId = params.chatId ?? "";

  const sessionId = initialSession.id;

  const {
    chats,
    loading: chatsLoading,
    createChat,
    deleteChat,
    renameChat,
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
        prStatus: initialSession.prStatus ?? null,
        linesAdded: initialSession.linesAdded,
        linesRemoved: initialSession.linesRemoved,
      },
      chats,
      chatsLoading,
      createChat,
      switchChat,
      deleteChat,
      renameChat,
    }),
    [
      initialSession,
      chats,
      chatsLoading,
      createChat,
      switchChat,
      deleteChat,
      renameChat,
    ],
  );

  return (
    <SessionLayoutContext.Provider value={layoutContext}>
      <GitPanelProvider>
        <SessionLayoutInner activeChatId={activeChatId}>
          {children}
        </SessionLayoutInner>
      </GitPanelProvider>
    </SessionLayoutContext.Provider>
  );
}
