import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  getChatSummariesBySessionId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionLayoutShell } from "./session-layout-shell";

interface SessionLayoutProps {
  params: Promise<{ sessionId: string }>;
  children: ReactNode;
}

export default async function SessionLayout({
  params,
  children,
}: SessionLayoutProps) {
  const { sessionId } = await params;

  const sessionPromise = getServerSession();
  const sessionRecordPromise = getSessionByIdCached(sessionId);

  const session = await sessionPromise;
  if (!session?.user) {
    redirect("/");
  }

  const sessionRecord = await sessionRecordPromise;
  if (!sessionRecord) {
    notFound();
  }

  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  let initialChatsData:
    | {
        chats: Awaited<ReturnType<typeof getChatSummariesBySessionId>>;
        defaultModelId: string | null;
      }
    | undefined;
  let initialSessionsData:
    | { sessions: Awaited<ReturnType<typeof getSessionsWithUnreadByUserId>> }
    | undefined;

  try {
    const [chats, preferences, sessions] = await Promise.all([
      getChatSummariesBySessionId(sessionId, session.user.id),
      getUserPreferences(session.user.id),
      getSessionsWithUnreadByUserId(session.user.id),
    ]);
    initialChatsData = {
      chats,
      defaultModelId: preferences.defaultModelId,
    };
    initialSessionsData = { sessions };
  } catch (error) {
    console.error("Failed to prefetch sidebar data:", error);
  }

  return (
    <SessionLayoutShell
      session={sessionRecord}
      currentUser={session.user}
      initialChatsData={initialChatsData}
      initialSessionsData={initialSessionsData}
    >
      {children}
    </SessionLayoutShell>
  );
}
