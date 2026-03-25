"use client";

import { Loader2, Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { InboxSidebar } from "@/components/inbox-sidebar";
import { getTopMissionControlSession } from "@/components/mission-control-session";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useBackgroundChatNotifications } from "@/hooks/use-background-chat-notifications";
import { useIsMobile } from "@/hooks/use-mobile";
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

function DetailPlaceholder({
  hasSessions,
  isLoadingPrioritySession,
  onOpenNewSession,
}: {
  hasSessions: boolean;
  isLoadingPrioritySession: boolean;
  onOpenNewSession: () => void;
}) {
  if (isLoadingPrioritySession) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Empty className="max-w-sm rounded-xl border border-dashed border-border/70">
          <EmptyMedia variant="icon">
            <Loader2 className="h-5 w-5 animate-spin" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Opening session</EmptyTitle>
            <EmptyDescription>
              Loading the session that needs your attention.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (hasSessions) {
    return null;
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Empty className="max-w-sm rounded-xl border border-dashed border-border/70">
        <EmptyMedia variant="icon">
          <Plus className="h-5 w-5" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No sessions yet</EmptyTitle>
          <EmptyDescription>
            Start a session to begin working with the agent.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" size="sm" onClick={onOpenNewSession}>
            <Plus className="h-4 w-4" />
            <span>New session</span>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function SessionsRouteShell({
  children,
  currentUser,
  initialSessionsData,
  lastRepo,
}: SessionsRouteShellProps) {
  const router = useRouter();
  const params = useParams<{ sessionId?: string }>();
  const isMobile = useIsMobile();
  const routeSessionId =
    typeof params.sessionId === "string" ? params.sessionId : null;
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [optimisticActiveSessionId, setOptimisticActiveSessionId] = useState<
    string | null
  >(null);
  const [isNavigating, startNavigationTransition] = useTransition();
  const prefetchedSessionHrefsRef = useRef(new Set<string>());
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const topMissionControlSession = useMemo(
    () => getTopMissionControlSession(sessions),
    [sessions],
  );

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
        if (isMobile) {
          setSheetOpen(false);
        }
        startNavigationTransition(() => {
          router.push("/sessions");
        });
      }
    },
    [
      archiveSession,
      isMobile,
      routeSessionId,
      router,
      startNavigationTransition,
    ],
  );

  useEffect(() => {
    if (
      optimisticActiveSessionId &&
      optimisticActiveSessionId === routeSessionId
    ) {
      setOptimisticActiveSessionId(null);
    }
  }, [optimisticActiveSessionId, routeSessionId]);

  useEffect(() => {
    if (
      isMobile ||
      routeSessionId ||
      optimisticActiveSessionId ||
      sessionsLoading ||
      !topMissionControlSession
    ) {
      return;
    }

    setOptimisticActiveSessionId(topMissionControlSession.id);
    startNavigationTransition(() => {
      router.replace(getSessionHref(topMissionControlSession));
    });
  }, [
    getSessionHref,
    isMobile,
    optimisticActiveSessionId,
    routeSessionId,
    router,
    sessionsLoading,
    startNavigationTransition,
    topMissionControlSession,
  ]);

  const activeSessionId = optimisticActiveSessionId ?? routeSessionId ?? "";
  const pendingSessionId = isNavigating ? optimisticActiveSessionId : null;
  const isLoadingPrioritySession =
    !isMobile && !routeSessionId && Boolean(topMissionControlSession);

  useBackgroundChatNotifications(sessions, routeSessionId, handleSessionClick);

  useEffect(() => {
    if (isMobile) {
      setSheetOpen(Boolean(routeSessionId));
      return;
    }

    setSheetOpen(false);
  }, [isMobile, routeSessionId]);

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setSheetOpen(true);
        return;
      }

      setSheetOpen(false);
      setOptimisticActiveSessionId(null);
      startNavigationTransition(() => {
        router.push("/sessions");
      });
    },
    [router, startNavigationTransition],
  );

  const shellContextValue = useMemo(
    () => ({
      openNewSessionDialog,
    }),
    [openNewSessionDialog],
  );

  return (
    <SessionsShellProvider value={shellContextValue}>
      <SidebarProvider className="h-dvh overflow-hidden">
        <div className="flex h-dvh w-full overflow-hidden bg-background">
          <div className="flex h-full w-full min-w-0 flex-col min-[900px]:w-[30rem] min-[900px]:shrink-0 min-[900px]:border-r min-[900px]:border-border/70">
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
          </div>

          {!isMobile ? (
            <div className="min-w-0 flex-1 bg-muted/20">
              {routeSessionId ? (
                <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
                  {children}
                </div>
              ) : (
                <DetailPlaceholder
                  hasSessions={sessions.length > 0}
                  isLoadingPrioritySession={isLoadingPrioritySession}
                  onOpenNewSession={openNewSessionDialog}
                />
              )}
            </div>
          ) : null}
        </div>

        {isMobile ? (
          <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
            <SheetContent
              side="right"
              className="w-full gap-0 p-0 data-[state=closed]:duration-200 data-[state=open]:duration-200 [&>[data-slot=sheet-close]]:hidden"
            >
              <div className="flex h-full flex-col overflow-hidden">
                {children}
              </div>
            </SheetContent>
          </Sheet>
        ) : null}
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
