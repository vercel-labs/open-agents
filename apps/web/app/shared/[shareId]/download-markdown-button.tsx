"use client";

import { Download } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { conversationToMarkdown } from "./conversation-to-markdown";
import type { MessageWithTiming } from "./shared-chat-content";

type ChatInput = {
  title: string | null;
  messages: ReadonlyArray<MessageWithTiming>;
};

type DownloadMarkdownButtonProps = {
  chats: ReadonlyArray<ChatInput>;
  shareId: string;
  title: string | null;
};

function safeFileSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 60) : "";
}

export function DownloadMarkdownButton({
  chats,
  shareId,
  title,
}: DownloadMarkdownButtonProps) {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(() => {
    setPending(true);
    try {
      const markdown = conversationToMarkdown({
        title,
        shareId,
        sharedAt: new Date(),
        chats,
      });
      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const slug = title ? safeFileSlug(title) : "";
      const base = slug ? `open-agents-${slug}` : `open-agents-${shareId}`;
      anchor.download = `${base}.md`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setPending(false);
    }
  }, [chats, shareId, title]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      className="gap-1.5"
    >
      <Download className="h-3.5 w-3.5" />
      Download as Markdown
    </Button>
  );
}
