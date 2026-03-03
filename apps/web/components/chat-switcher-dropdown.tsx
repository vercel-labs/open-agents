"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useSessionLayout } from "@/app/sessions/[sessionId]/session-layout-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ChatSwitcherDropdown() {
  const params = useParams<{ chatId?: string; sessionId?: string }>();
  const router = useRouter();
  const activeChatId = params.chatId ?? "";
  const { chats, createChat, switchChat } = useSessionLayout();

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const label = activeChat?.title || "Chat";

  const handleNewChat = () => {
    const previousChatId = activeChatId;
    try {
      const { chat, persisted } = createChat();
      switchChat(chat.id);
      void persisted.catch((err) => {
        console.error("Failed to create chat:", err);
        if (previousChatId && params.sessionId) {
          router.replace(
            `/sessions/${params.sessionId}/chats/${previousChatId}`,
          );
        }
      });
    } catch (err) {
      console.error("Failed to create chat:", err);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <span className="max-w-[160px] truncate">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        {chats.map((chat) => (
          <DropdownMenuItem
            key={chat.id}
            onClick={() => switchChat(chat.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{chat.title || "Untitled"}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {chat.isStreaming && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              )}
              {chat.id === activeChatId && (
                <Check className="h-3.5 w-3.5 text-foreground" />
              )}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleNewChat} className="gap-2">
          <Plus className="h-3.5 w-3.5" />
          <span>New chat</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
