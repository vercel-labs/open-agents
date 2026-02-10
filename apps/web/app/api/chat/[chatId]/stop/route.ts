import { getChatById, getSessionById } from "@/lib/db/sessions";
import { createRedisClient } from "@/lib/redis";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { chatId } = await context.params;

  const chat = await getChatById(chatId);
  if (!chat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  // Verify ownership through the session chain
  const sessionRecord = await getSessionById(chat.sessionId);
  if (!sessionRecord || sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Publish stop signal via Redis pub/sub
  const publisher = createRedisClient();
  await publisher.publish(`stop:${chatId}`, "stop");
  publisher.disconnect();

  return Response.json({ success: true });
}
