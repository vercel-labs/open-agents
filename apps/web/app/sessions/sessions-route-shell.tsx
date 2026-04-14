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
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { DEFAULT_SANDBOX_TYPE } from "@/components/sandbox-selector-compact";
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
    unarchiveSession,
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

  const { preferences } = useUserPreferences();

  const openNewSessionDialog = useCallback(() => {
    setNewSessionOpen(true);
  }, []);

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      if (targetSession.id === (optimisticActiveSessionId ?? routeSessionId)) {
        return;
      }

      const href = getSessionHref(targetSession);
      prefetchedSessionHrefsRef.current.add(href);
      setOptimisticActiveSessionId(targetSession.id);
      startNavigationTransition(() => {
        router.push(href, { scroll: false });
      });
    },
    [
      getSessionHref,
      optimisticActiveSessionId,
      routeSessionId,
      router,
      startNavigationTransition,
    ],
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const session of sessions.slice(0, 6)) {
        const href = getSessionHref(session);
        if (prefetchedSessionHrefsRef.current.has(href)) {
          continue;
        }

        prefetchedSessionHrefsRef.current.add(href);
        router.prefetch(href);
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
    };
  }, [getSessionHref, router, sessions]);

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
          router.push("/sessions", { scroll: false });
        });
      }
    },
    [archiveSession, routeSessionId, router, startNavigationTransition],
  );

  const handleUnarchiveSession = useCallback(
    async (targetSessionId: string) => {
      await unarchiveSession(targetSessionId);

      if (targetSessionId === routeSessionId) {
        window.location.reload();
      }
    },
    [routeSessionId, unarchiveSession],
  );

  const handleCreateSessionForRepo = useCallback(
    async (repoOwner: string, repoName: string) => {
      try {
        const { session: created, chat } = await createSession({
          repoOwner,
          repoName,
          cloneUrl: `https://github.com/${repoOwner}/${repoName}`,
          isNewBranch: true,
          sandboxType: preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE,
          autoCommitPush: preferences?.autoCommitPush ?? false,
          autoCreatePr: preferences?.autoCreatePr ?? false,
        });
        router.push(`/sessions/${created.id}/chats/${chat.id}`, {
          scroll: false,
        });
      } catch (error) {
        console.error("Failed to create session for repo:", error);
      }
    },
    [createSession, preferences, router],
  );

  const handleCreateSessionFromBranch = useCallback(
    async (repoOwner: string, repoName: string, branch: string) => {
      try {
        const { session: created, chat } = await createSession({
          repoOwner,
          repoName,
          branch,
          cloneUrl: `https://github.com/${repoOwner}/${repoName}`,
          isNewBranch: false,
          sandboxType: preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE,
          autoCommitPush: preferences?.autoCommitPush ?? false,
          autoCreatePr: preferences?.autoCreatePr ?? false,
        });
        router.push(`/sessions/${created.id}/chats/${chat.id}`, {
          scroll: false,
        });
      } catch (error) {
        console.error("Failed to create session from branch:", error);
      }
    },
    [createSession, preferences, router],
  );

  useEffect(() => {
    if (
      optimisticActiveSessionId &&
      optimisticActiveSessionId === routeSessionId
    ) {
      setOptimisticActiveSessionId(null);
    }
  }, [optimisticActiveSessionId, routeSessionId]);

  const activeSessionId = optimisticActiveSessionId ?? routeSessionId ?? "";
  const pendingSessionId = isNavigating ? optimisticActiveSessionId : null;

  useBackgroundChatNotifications(sessions, routeSessionId, handleSessionClick, {
    alertsEnabled: preferences?.alertsEnabled ?? true,
    alertSoundEnabled: preferences?.alertSoundEnabled ?? true,
  });

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
              onUnarchiveSession={handleUnarchiveSession}
              onOpenNewSession={openNewSessionDialog}
              onCreateSessionForRepo={handleCreateSessionForRepo}
              onCreateSessionFromBranch={handleCreateSessionFromBranch}
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
