"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useSessionChats } from "@/hooks/use-session-chats";
import type { Session } from "@/lib/db/schema";
import { ChatSidebar } from "./chats/[chatId]/chat-sidebar";
import { SessionLayoutContext } from "./session-layout-context";

type SessionLayoutShellProps = {
  session: Session;
  children: React.ReactNode;
};

export function SessionLayoutShell({
  session: initialSession,
  children,
}: SessionLayoutShellProps) {
  const router = useRouter();
  const params = useParams<{ sessionId: string; chatId?: string }>();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState(initialSession.title);
  const [optimisticActiveChatId, setOptimisticActiveChatId] = useState<
    string | null
  >(null);
  const optimisticActiveChatIdRef = useRef<string | null>(null);

  const sessionId = params.sessionId;

  const {
    chats,
    createChat,
    renameChat,
    deleteChat,
    loading: chatsLoading,
  } = useSessionChats(sessionId);

  const activeChatId = optimisticActiveChatId ?? params.chatId ?? "";

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    optimisticActiveChatIdRef.current = optimisticActiveChatId;
  }, [optimisticActiveChatId]);

  // Reset optimistic ID when the route catches up
  useEffect(() => {
    setOptimisticActiveChatId(null);
  }, [params.chatId]);

  const updateSessionTitle = useCallback(
    async (title: string) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      if (res.ok) {
        setSessionTitle(title);
      }
    },
    [sessionId],
  );

  const handleChatSwitch = useCallback(
    (nextChatId: string) => {
      if (nextChatId === activeChatId) return;
      setOptimisticActiveChatId(nextChatId);
      setMobileSidebarOpen(false);
      router.push(`/sessions/${sessionId}/chats/${nextChatId}`);
    },
    [router, sessionId, activeChatId],
  );

  const handleCreateChat = useCallback(() => {
    const previousChatId = params.chatId ?? "";
    try {
      const { chat: newChat, persisted } = createChat();
      const optimisticPath = `/sessions/${sessionId}/chats/${newChat.id}`;
      setOptimisticActiveChatId(newChat.id);
      router.push(optimisticPath);
      void persisted.catch((err) => {
        console.error("Failed to create chat:", err);
        if (
          optimisticActiveChatIdRef.current === newChat.id ||
          pathnameRef.current === optimisticPath
        ) {
          setOptimisticActiveChatId(previousChatId || null);
          if (previousChatId) {
            router.replace(`/sessions/${sessionId}/chats/${previousChatId}`);
          }
        }
      });
    } catch (err) {
      console.error("Failed to create chat:", err);
    }
  }, [params.chatId, createChat, sessionId, router]);

  const handleDeleteChat = useCallback(
    async (targetChatId: string) => {
      if (chats.length <= 1) return;
      const targetChat = chats.find((c) => c.id === targetChatId);
      const confirmed = window.confirm(
        `Delete chat "${targetChat?.title ?? "Untitled"}"?`,
      );
      if (!confirmed) return;

      const fallbackChat = chats.find((c) => c.id !== targetChatId);
      try {
        await deleteChat(targetChatId);
        if (targetChatId === activeChatId && fallbackChat) {
          router.replace(`/sessions/${sessionId}/chats/${fallbackChat.id}`);
        }
      } catch (err) {
        console.error("Failed to delete chat:", err);
      }
    },
    [chats, deleteChat, activeChatId, router, sessionId],
  );

  const sidebarContent = (
    <ChatSidebar
      sessionTitle={sessionTitle}
      updateSessionTitle={updateSessionTitle}
      chats={chats}
      chatsLoading={chatsLoading}
      activeChatId={activeChatId}
      onChatSwitch={handleChatSwitch}
      onCreateChat={handleCreateChat}
      onRenameChat={renameChat}
      onDeleteChat={handleDeleteChat}
      onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
    />
  );

  const layoutContext = useMemo(
    () => ({
      openMobileSidebar: () => setMobileSidebarOpen(true),
    }),
    [],
  );

  return (
    <SessionLayoutContext.Provider value={layoutContext}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-muted/20 md:flex">
          {sidebarContent}
        </aside>

        {/* Mobile sidebar Drawer */}
        <Drawer open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <DrawerContent className="h-[85dvh] md:hidden">
            <DrawerHeader className="sr-only">
              <DrawerTitle>Navigation</DrawerTitle>
            </DrawerHeader>
            {sidebarContent}
          </DrawerContent>
        </Drawer>

        {/* Main content area */}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </SessionLayoutContext.Provider>
  );
}
