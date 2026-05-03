import { notFound, redirect } from "next/navigation";
import { getChatsBySessionId } from "@/lib/db/sessions";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import { redirectManagedTemplateUser } from "@/lib/managed-template-page-access";
import { getServerSession } from "@/lib/session/get-server-session";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;

  const sessionPromise = getServerSession();
  const sessionRecordPromise = getSessionByIdCached(sessionId);

  const session = await sessionPromise;
  if (!session?.user) {
    redirect("/");
  }
  await redirectManagedTemplateUser(session);

  const sessionRecord = await sessionRecordPromise;
  if (!sessionRecord) {
    notFound();
  }

  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  const chats = await getChatsBySessionId(sessionId);
  const targetChat = chats[0];

  if (!targetChat) {
    notFound();
  }

  redirect(`/sessions/${sessionId}/chats/${targetChat.id}`);
}
