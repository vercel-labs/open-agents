"use client";

import { MessageSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { InboxSidebar } from "@/components/inbox-sidebar";
import { NewSessionDialog } from "@/components/new-session-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useSessions, type SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";

type SessionsIndexShellProps = {
  lastRepo: { owner: string; repo: string } | null;
  currentUser: AuthSession["user"];
  initialSessionsData?: {
    sessions: SessionWithUnread[];
    archivedCount: number;
  };
};

export function SessionsIndexShell({
  lastRepo,
  currentUser,
  initialSessionsData,
}: SessionsIndexShellProps) {
  const router = useRouter();
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const {
    sessions,
    archivedCount,
    loading: sessionsLoading,
    refreshSessions,
    createSession,
    archiveSession,
  } = useSessions({
    enabled: true,
    includeArchived: false,
    initialData: initialSessionsData,
  });

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

  const handleArchiveSession = useCallback(
    async (targetSessionId: string) => {
      await archiveSession(targetSessionId);
    },
    [archiveSession],
  );

  return (
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
          <InboxSidebar
            sessions={sessions}
            archivedCount={archivedCount}
            sessionsLoading={sessionsLoading}
            activeSessionId=""
            onSessionClick={handleSessionClick}
            onSessionPrefetch={handleSessionPrefetch}
            onRenameSession={handleRenameSession}
            onArchiveSession={handleArchiveSession}
            createSession={createSession}
            lastRepo={lastRepo}
            initialUser={currentUser}
          />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border px-3 py-2 lg:px-4 lg:py-3">
          <div className="flex min-h-8 items-center gap-2">
            <SidebarTrigger className="shrink-0" />
          </div>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquare />
              </EmptyMedia>
              <EmptyTitle>Select a Session</EmptyTitle>
              <EmptyDescription>
                Choose a session from the sidebar to continue, or start a new
                one.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setNewSessionOpen(true)}>
                <Plus className="h-4 w-4" />
                New Session
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </SidebarInset>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        lastRepo={lastRepo}
        createSession={createSession}
      />
    </SidebarProvider>
  );
}
