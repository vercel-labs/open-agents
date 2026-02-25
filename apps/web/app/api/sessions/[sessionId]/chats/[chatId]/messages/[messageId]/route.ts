import { getServerSession } from "@/lib/session/get-server-session";
import {
  deleteChatMessageAndFollowing,
  getChatById,
  getSessionById,
} from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string; messageId: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, chatId, messageId } = await context.params;

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

  if (chat.activeStreamId) {
    return Response.json(
      { error: "Cannot delete messages while a response is streaming" },
      { status: 409 },
    );
  }

  const result = await deleteChatMessageAndFollowing(chatId, messageId);

  if (result.status === "not_found") {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  if (result.status === "not_user_message") {
    return Response.json(
      { error: "Only user messages can be deleted" },
      { status: 400 },
    );
  }

  return Response.json({
    success: true,
    deletedMessageIds: result.deletedMessageIds,
  });
}
