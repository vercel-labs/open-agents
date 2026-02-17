import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import { DiffsProvider } from "@/components/diffs-provider";
import {
  getChatById,
  getChatMessages,
  getSessionById,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionChatContent } from "./session-chat-content";
import { SessionChatProvider } from "./session-chat-context";

interface SessionChatPageProps {
  params: Promise<{ sessionId: string; chatId: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getChatByIdWithRetry(
  chatId: string,
  sessionId: string,
): Promise<Awaited<ReturnType<typeof getChatById>>> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const chat = await getChatById(chatId);
    if (chat && chat.sessionId === sessionId) {
      return chat;
    }
    if (attempt < maxAttempts) {
      await sleep(80);
    }
  }
  return undefined;
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

  const chat = await getChatByIdWithRetry(chatId, sessionId);
  if (!chat) {
    notFound();
  }

  // Fetch messages and transform to WebAgentUIMessage[]
  const dbMessages = await getChatMessages(chatId);
  const initialMessages = dbMessages.map((m) => m.parts as WebAgentUIMessage);

  return (
    <DiffsProvider>
      <SessionChatProvider
        session={sessionRecord}
        chat={chat}
        initialMessages={initialMessages}
      >
        <SessionChatContent />
      </SessionChatProvider>
    </DiffsProvider>
  );
}
