import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import {
  getChatById,
  getChatMessages,
  getSessionById,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionChatProvider } from "./session-chat-context";
import { SessionChatContent } from "./session-chat-content";

interface SessionChatPageProps {
  params: Promise<{ sessionId: string; chatId: string }>;
}

export async function generateMetadata({
  params,
}: SessionChatPageProps): Promise<Metadata> {
  const { sessionId } = await params;

  return {
    title: `Session ${sessionId}`,
    description: "Review session progress, chats, and outputs.",
  };
}

export default async function SessionChatPage({
  params,
}: SessionChatPageProps) {
  const { sessionId, chatId } = await params;

  // Server-side auth check
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  // Fetch session + chat
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    notFound();
  }

  // Check ownership
  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  const chat = await getChatById(chatId);
  if (!chat || chat.sessionId !== sessionId) {
    notFound();
  }

  // Fetch messages and transform to WebAgentUIMessage[]
  const dbMessages = await getChatMessages(chatId);
  const initialMessages = dbMessages.map((m) => m.parts as WebAgentUIMessage);

  return (
    <SessionChatProvider
      session={sessionRecord}
      chat={chat}
      initialMessages={initialMessages}
    >
      <SessionChatContent />
    </SessionChatProvider>
  );
}
