import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import type { WebAgentUIMessage } from "@/app/types";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getChatById, getChatMessages } from "@/lib/db/sessions";
import {
  getSessionByIdCached,
  getShareByIdCached,
} from "@/lib/db/sessions-cache";
import { SharedChatContent } from "./shared-chat-content";

interface SharedPageProps {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({
  params,
}: SharedPageProps): Promise<Metadata> {
  const { shareId } = await params;
  const share = await getShareByIdCached(shareId);
  const sharedChat = share ? await getChatById(share.chatId) : null;

  return {
    title: sharedChat?.title ?? "Shared Chat",
    description: "A shared Open Harness chat.",
  };
}

export default async function SharedPage({ params }: SharedPageProps) {
  const { shareId } = await params;

  const share = await getShareByIdCached(shareId);
  if (!share) {
    notFound();
  }

  const sharedChat = await getChatById(share.chatId);
  if (!sharedChat) {
    notFound();
  }

  const session = await getSessionByIdCached(sharedChat.sessionId);
  if (!session) {
    notFound();
  }

  // Fetch the user who owns this session (public profile info only)
  const sessionUser = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: {
      username: true,
      name: true,
      avatarUrl: true,
    },
  });

  const dbMessages = await getChatMessages(sharedChat.id);
  const messages = dbMessages.map((m) => m.parts as WebAgentUIMessage);

  const { title, repoOwner, repoName, branch, cloneUrl, prNumber, prStatus } =
    session;

  return (
    <SharedChatContent
      session={{ title, repoOwner, repoName, branch, cloneUrl, prNumber, prStatus }}
      chats={[{ chat: sharedChat, messages }]}
      modelId={sharedChat.modelId}
      sharedBy={
        sessionUser
          ? {
              username: sessionUser.username,
              name: sessionUser.name,
              avatarUrl: sessionUser.avatarUrl,
            }
          : null
      }
    />
  );
}
