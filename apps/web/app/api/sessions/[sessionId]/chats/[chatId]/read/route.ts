import { getServerSession } from "@/lib/session/get-server-session";
import {
  getChatById,
  getSessionById,
  markChatRead,
} from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

export async function POST(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, chatId } = await context.params;

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const chat = await getChatById(chatId);
  if (!chat || chat.sessionId !== sessionId) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  await markChatRead({ userId: session.user.id, chatId });
  return Response.json({ success: true });
}
