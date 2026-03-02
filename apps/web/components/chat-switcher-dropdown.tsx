"use client";

import { ChevronDown, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionLayout } from "@/app/sessions/[sessionId]/session-layout-context";

interface ChatSwitcherDropdownProps {
  activeChatId: string;
}

export function ChatSwitcherDropdown({
  activeChatId,
}: ChatSwitcherDropdownProps) {
  const { chats, createChat, switchChat } = useSessionLayout();

  const activeChat = chats.find((c) => c.id === activeChatId);
  const label = activeChat?.title || "Chat";

  const handleNewChat = () => {
    const { chat } = createChat();
    switchChat(chat.id);
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
