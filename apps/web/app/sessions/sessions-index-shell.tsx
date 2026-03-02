"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { InboxSidebar } from "@/components/inbox-sidebar";
import { NewSessionDialog } from "@/components/new-session-dialog";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useSessions, type SessionWithUnread } from "@/hooks/use-sessions";

type SessionsIndexShellProps = {
  lastRepo: { owner: string; repo: string } | null;
  initialSessionsData?: {
    sessions: SessionWithUnread[];
  };
};

export function SessionsIndexShell({
  lastRepo,
  initialSessionsData,
}: SessionsIndexShellProps) {
  const router = useRouter();
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const {
    sessions,
    loading: sessionsLoading,
    refreshSessions,
    createSession,
  } = useSessions({ enabled: true, initialData: initialSessionsData });

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
            sessionsLoading={sessionsLoading}
            activeSessionId=""
            onSessionClick={handleSessionClick}
            onSessionPrefetch={handleSessionPrefetch}
            onRenameSession={handleRenameSession}
            createSession={createSession}
            lastRepo={lastRepo}
          />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border px-3 py-2 lg:px-4 lg:py-3">
          <div className="flex min-h-8 items-center gap-2">
            <SidebarTrigger className="shrink-0" />
          </div>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Button
            size="lg"
            onClick={() => setNewSessionOpen(true)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            New Session
          </Button>
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
