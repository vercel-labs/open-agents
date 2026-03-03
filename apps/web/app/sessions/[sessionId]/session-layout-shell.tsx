"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { InboxSidebar } from "@/components/inbox-sidebar";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  type SessionChatListItem,
  useSessionChats,
} from "@/hooks/use-session-chats";
import { useSessions, type SessionWithUnread } from "@/hooks/use-sessions";
import type { Session } from "@/lib/db/schema";
import { SessionLayoutContext } from "./session-layout-context";

type SessionLayoutShellProps = {
  session: Session;
  initialChatsData?: {
    defaultModelId: string | null;
    chats: SessionChatListItem[];
  };
  initialSessionsData?: {
    sessions: SessionWithUnread[];
  };
  children: React.ReactNode;
};

export function SessionLayoutShell({
  session: initialSession,
  initialChatsData,
  initialSessionsData,
  children,
}: SessionLayoutShellProps) {
  const router = useRouter();

  const sessionId = initialSession.id;

  const {
    chats,
    loading: chatsLoading,
    createChat,
  } = useSessionChats(sessionId, { initialData: initialChatsData });

  const {
    sessions,
    loading: sessionsLoading,
    refreshSessions,
    createSession,
  } = useSessions({
    enabled: true,
    initialData: initialSessionsData,
  });

  // Derive hasStreaming for the current session from the chats list, which
  // already reflects optimistic streaming state. This makes the inbox sidebar
  // indicator update immediately without waiting for a server round-trip.
  const sessionsWithStreaming = useMemo(() => {
    const anyStreaming = chats.some((c) => c.isStreaming);
    return sessions.map((s) =>
      s.id === sessionId ? { ...s, hasStreaming: anyStreaming } : s,
    );
  }, [sessions, chats, sessionId]);

  const lastRepo = useMemo(() => {
    if (initialSession.repoOwner && initialSession.repoName) {
      return {
        owner: initialSession.repoOwner,
        repo: initialSession.repoName,
      };
    }
    return null;
  }, [initialSession.repoOwner, initialSession.repoName]);

  const getSessionHref = useCallback((targetSession: SessionWithUnread) => {
    if (targetSession.latestChatId) {
      return `/sessions/${targetSession.id}/chats/${targetSession.latestChatId}`;
    }
    return `/sessions/${targetSession.id}`;
  }, []);

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      router.push(getSessionHref(targetSession));
    },
    [getSessionHref, router],
  );

  const handleSessionPrefetch = useCallback(
    (targetSession: SessionWithUnread) => {
      router.prefetch(getSessionHref(targetSession));
    },
    [getSessionHref, router],
  );

  const handleRenameSession = useCallback(
    async (targetSessionId: string, title: string) => {
      await fetch(`/api/sessions/${targetSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await refreshSessions();
    },
    [refreshSessions],
  );

  const switchChat = useCallback(
    (chatId: string) => {
      router.push(`/sessions/${sessionId}/chats/${chatId}`);
    },
    [router, sessionId],
  );

  const sidebarContent = (
    <InboxSidebar
      sessions={sessionsWithStreaming}
      sessionsLoading={sessionsLoading}
      activeSessionId={sessionId}
      onSessionClick={handleSessionClick}
      onSessionPrefetch={handleSessionPrefetch}
      onRenameSession={handleRenameSession}
      createSession={createSession}
      lastRepo={lastRepo}
    />
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
      <SidebarProvider
        className="h-dvh overflow-hidden"
        style={
          {
            "--sidebar-width": "20rem",
          } as React.CSSProperties
        }
      >
        <Sidebar collapsible="offcanvas" className="border-r border-border">
          <SidebarContent className="bg-muted/20">
            {sidebarContent}
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </SidebarInset>
      </SidebarProvider>
    </SessionLayoutContext.Provider>
  );
}
