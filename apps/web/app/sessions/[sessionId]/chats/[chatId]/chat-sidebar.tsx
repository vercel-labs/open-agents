"use client";

import {
  ArrowLeft,
  Check,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SessionChatListItem } from "@/hooks/use-session-chats";

type ChatSidebarProps = {
  sessionTitle: string;
  updateSessionTitle: (title: string) => Promise<void>;
  chats: SessionChatListItem[];
  chatsLoading: boolean;
  activeChatId: string;
  onChatSwitch: (chatId: string) => void;
  onCreateChat: () => void;
  onRenameChat: (chatId: string, title: string) => Promise<unknown>;
  onDeleteChat: (chatId: string) => Promise<unknown>;
  onCloseMobileSidebar?: () => void;
};

export function ChatSidebar({
  sessionTitle,
  updateSessionTitle,
  chats,
  chatsLoading,
  activeChatId,
  onChatSwitch,
  onCreateChat,
  onRenameChat,
  onDeleteChat,
  onCloseMobileSidebar,
}: ChatSidebarProps) {
  const router = useRouter();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const chatTitleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  useEffect(() => {
    if (editingChatId && chatTitleInputRef.current) {
      chatTitleInputRef.current.focus();
      chatTitleInputRef.current.select();
    }
  }, [editingChatId]);

  const handleRenameChat = useCallback(
    async (targetChatId: string, nextTitle: string) => {
      const trimmedTitle = nextTitle.trim();
      if (!trimmedTitle) {
        setEditingChatId(null);
        return;
      }
      try {
        await onRenameChat(targetChatId, trimmedTitle);
      } catch (err) {
        console.error("Failed to rename chat:", err);
      } finally {
        setEditingChatId(null);
      }
    },
    [onRenameChat],
  );

  const saveSessionTitle = useCallback(
    async (title: string) => {
      if (title.trim()) {
        try {
          await updateSessionTitle(title.trim());
        } catch (err) {
          console.error("Failed to update title:", err);
        }
      }
      setIsEditingTitle(false);
    },
    [updateSessionTitle],
  );

  return (
    <>
      <div className="border-b border-border p-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Sessions
        </button>
        {isEditingTitle ? (
          <div className="flex items-center gap-1">
            <input
              ref={titleInputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  await saveSessionTitle(editedTitle);
                } else if (e.key === "Escape") {
                  setIsEditingTitle(false);
                }
              }}
              onBlur={async () => {
                if (editedTitle.trim() && editedTitle !== sessionTitle) {
                  await saveSessionTitle(editedTitle);
                } else {
                  setIsEditingTitle(false);
                }
              }}
              className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => void saveSessionTitle(editedTitle)}
              className="rounded p-1 hover:bg-muted"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditedTitle(sessionTitle);
              setIsEditingTitle(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          >
            <span className="truncate text-sm font-medium">{sessionTitle}</span>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onCloseMobileSidebar?.();
            onCreateChat();
          }}
          disabled={chatsLoading}
          className="mt-3 w-full justify-start"
        >
          <Plus className="mr-2 h-4 w-4" />
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {chats.map((c) => (
            <div
              key={c.id}
              className={`group relative flex items-center rounded-md ${
                c.id === activeChatId ? "bg-secondary" : "hover:bg-muted"
              }`}
            >
              {editingChatId === c.id ? (
                <input
                  ref={chatTitleInputRef}
                  type="text"
                  value={editingChatTitle}
                  onChange={(e) => setEditingChatTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRenameChat(c.id, editingChatTitle);
                    } else if (e.key === "Escape") {
                      setEditingChatId(null);
                    }
                  }}
                  onBlur={() => {
                    void handleRenameChat(c.id, editingChatTitle);
                  }}
                  className="h-8 min-w-0 flex-1 rounded bg-transparent px-2 text-sm focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onChatSwitch(c.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 pr-10 text-left text-sm transition-colors ${
                    c.id === activeChatId
                      ? "text-secondary-foreground"
                      : "text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="truncate">{c.title}</span>
                </button>
              )}
              {c.isStreaming && (
                <span
                  className="pointer-events-none absolute top-1/2 right-3 size-2 -translate-y-1/2 rounded-full bg-white animate-pulse transition-opacity group-hover:opacity-0"
                  aria-label="Streaming response"
                />
              )}
              {editingChatId !== c.id &&
                c.id !== activeChatId &&
                !c.isStreaming &&
                c.hasUnread && (
                  <span
                    className="pointer-events-none absolute top-1/2 left-1 size-2 -translate-y-1/2 rounded-full bg-emerald-500 transition-opacity group-hover:opacity-0"
                    aria-label="Unread messages"
                  />
                )}
              {editingChatId !== c.id && (
                <div className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingChatId(c.id);
                      setEditingChatTitle(c.title);
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    aria-label={`Rename ${c.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onDeleteChat(c.id);
                    }}
                    disabled={chats.length <= 1}
                    className="rounded p-1.5 text-muted-foreground hover:bg-background/60 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Delete ${c.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
