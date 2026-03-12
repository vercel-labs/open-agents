"use client";

import { useParams, useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useBrowserNotifications } from "@/app/providers";
import { InboxSidebar } from "@/components/inbox-sidebar";
import { NewSessionDialog } from "@/components/new-session-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { useBackgroundChatNotifications } from "@/hooks/use-background-chat-notifications";
import { useSessions, type SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { SessionsShellProvider } from "./sessions-shell-context";

type SessionsRouteShellProps = {
  children: ReactNode;
  currentUser: AuthSession["user"];
  initialSessionsData?: {
    sessions: SessionWithUnread[];
    archivedCount: number;
  };
  lastRepo: { owner: string; repo: string } | null;
};

const RouteContentShell = memo(function RouteContentShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {children}
    </SidebarInset>
  );
});

export function SessionsRouteShell({
  children,
  currentUser,
  initialSessionsData,
  lastRepo,
}: SessionsRouteShellProps) {
  const router = useRouter();
  const params = useParams<{ sessionId?: string }>();
  const routeSessionId =
    typeof params.sessionId === "string" ? params.sessionId : null;
  const { canSendNotifications, showNotification } = useBrowserNotifications();
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [optimisticActiveSessionId, setOptimisticActiveSessionId] = useState<
    string | null
  >(null);
  const [isNavigating, startNavigationTransition] = useTransition();
  const prefetchedSessionHrefsRef = useRef(new Set<string>());

  const {
    sessions,
    archivedCount,
    loading: sessionsLoading,
    createSession,
    renameSession,
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

  const openNewSessionDialog = useCallback(() => {
    setNewSessionOpen(true);
  }, []);

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      setOptimisticActiveSessionId(targetSession.id);
      startNavigationTransition(() => {
        router.push(getSessionHref(targetSession));
      });
    },
    [getSessionHref, router, startNavigationTransition],
  );

  const handleSessionPrefetch = useCallback(
    (targetSession: SessionWithUnread) => {
      const href = getSessionHref(targetSession);
      if (prefetchedSessionHrefsRef.current.has(href)) {
        return;
      }

      prefetchedSessionHrefsRef.current.add(href);
      router.prefetch(href);
    },
    [getSessionHref, router],
  );

  const handleRenameSession = useCallback(
    async (targetSessionId: string, title: string) => {
      await renameSession(targetSessionId, title);
    },
    [renameSession],
  );

  const handleArchiveSession = useCallback(
    async (targetSessionId: string) => {
      await archiveSession(targetSessionId);

      if (targetSessionId === routeSessionId) {
        setOptimisticActiveSessionId(null);
        startNavigationTransition(() => {
          router.push("/sessions");
        });
      }
    },
    [archiveSession, routeSessionId, router, startNavigationTransition],
  );

  useEffect(() => {
    if (
      optimisticActiveSessionId &&
      optimisticActiveSessionId === routeSessionId
    ) {
      setOptimisticActiveSessionId(null);
    }
  }, [optimisticActiveSessionId, routeSessionId]);

  const handleBrowserNotification = useCallback(
    (targetSession: SessionWithUnread) => {
      showNotification({
        title: "Agent finished",
        body: targetSession.title || "A session",
        tag: `background-session-complete-${targetSession.id}-${targetSession.latestChatId ?? "latest"}`,
        url: getSessionHref(targetSession),
      });
    },
    [getSessionHref, showNotification],
  );

  const activeSessionId = optimisticActiveSessionId ?? routeSessionId ?? "";
  const pendingSessionId = isNavigating ? optimisticActiveSessionId : null;

  useBackgroundChatNotifications(
    sessions,
    routeSessionId,
    handleSessionClick,
    canSendNotifications,
    handleBrowserNotification,
  );

  const shellContextValue = useMemo(
    () => ({
      openNewSessionDialog,
    }),
    [openNewSessionDialog],
  );

  return (
    <SessionsShellProvider value={shellContextValue}>
      <SidebarProvider
        className="h-dvh overflow-hidden"
        style={
          {
            "--sidebar-width": "20rem",
          } as CSSProperties
        }
      >
        <Sidebar collapsible="offcanvas" className="border-r border-border">
          <SidebarContent className="bg-muted/20">
            <InboxSidebar
              sessions={sessions}
              archivedCount={archivedCount}
              sessionsLoading={sessionsLoading}
              activeSessionId={activeSessionId}
              pendingSessionId={pendingSessionId}
              onSessionClick={handleSessionClick}
              onSessionPrefetch={handleSessionPrefetch}
              onRenameSession={handleRenameSession}
              onArchiveSession={handleArchiveSession}
              onOpenNewSession={openNewSessionDialog}
              initialUser={currentUser}
            />
          </SidebarContent>
        </Sidebar>
        <RouteContentShell>{children}</RouteContentShell>
      </SidebarProvider>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        lastRepo={lastRepo}
        createSession={createSession}
      />
    </SessionsShellProvider>
  );
}
