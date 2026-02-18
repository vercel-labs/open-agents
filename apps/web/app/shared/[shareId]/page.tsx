import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import {
  getChatMessages,
  getChatsBySessionId,
  getSessionByShareId,
} from "@/lib/db/sessions";
import { SharedChatContent } from "./shared-chat-content";

interface SharedPageProps {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({
  params,
}: SharedPageProps): Promise<Metadata> {
  const { shareId } = await params;
  const session = await getSessionByShareId(shareId);

  return {
    title: session?.title ?? "Shared Session",
    description: "A shared Open Harness session.",
  };
}

export default async function SharedPage({ params }: SharedPageProps) {
  const { shareId } = await params;

  const session = await getSessionByShareId(shareId);
  if (!session) {
    notFound();
  }

  // Get all chats for this session (newest first)
  const sessionChats = await getChatsBySessionId(session.id);
  if (sessionChats.length === 0) {
    notFound();
  }

  // Load messages for all chats
  const chatsWithMessages = await Promise.all(
    sessionChats.map(async (chat) => {
      const dbMessages = await getChatMessages(chat.id);
      const messages = dbMessages.map((m) => m.parts as WebAgentUIMessage);
      return { chat, messages };
    }),
  );

  // Sort chats oldest-first for reading order
  chatsWithMessages.reverse();

  const { title, repoOwner, repoName, branch, cloneUrl } = session;

  return (
    <SharedChatContent
      session={{ title, repoOwner, repoName, branch, cloneUrl }}
      chats={chatsWithMessages}
    />
  );
}
