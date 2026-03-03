import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { WebAgentUIMessage } from "@/app/types";
import { getChatMessages, getChatsBySessionId } from "@/lib/db/sessions";
import { getSessionByShareIdCached } from "@/lib/db/sessions-cache";
import { SharedChatContent } from "./shared-chat-content";

interface SharedPageProps {
  params: Promise<{ shareId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: SharedPageProps): Promise<Metadata> {
  const { shareId } = await params;
  const session = await getSessionByShareIdCached(shareId);

  return {
    title: session?.title ?? "Shared Session",
    description: "A shared Open Harness session.",
  };
}

export default async function SharedPage({
  params,
  searchParams,
}: SharedPageProps) {
  const { shareId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const chatIdParam = resolvedSearchParams?.chatId;
  const requestedChatId =
    typeof chatIdParam === "string" && chatIdParam.length > 0
      ? chatIdParam
      : null;

  const session = await getSessionByShareIdCached(shareId);
  if (!session) {
    notFound();
  }

  const sessionChats = await getChatsBySessionId(session.id);
  if (sessionChats.length === 0) {
    notFound();
  }

  const targetChat = requestedChatId
    ? (sessionChats.find((chat) => chat.id === requestedChatId) ?? null)
    : (sessionChats[0] ?? null);

  if (!targetChat) {
    notFound();
  }

  const dbMessages = await getChatMessages(targetChat.id);
  const messages = dbMessages.map((m) => m.parts as WebAgentUIMessage);

  const { title, repoOwner, repoName, branch, cloneUrl } = session;

  return (
    <SharedChatContent
      session={{ title, repoOwner, repoName, branch, cloneUrl }}
      chats={[{ chat: targetChat, messages }]}
    />
  );
}
