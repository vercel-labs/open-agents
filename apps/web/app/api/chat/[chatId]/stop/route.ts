import { getChatById, getSessionById } from "@/lib/db/sessions";
import {
  createRedisClient,
  isRedisConfigured,
  warnRedisDisabled,
} from "@/lib/redis";
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
  if (!isRedisConfigured()) {
    warnRedisDisabled("Chat stop endpoint");
    return Response.json(
      {
        error:
          "Stop signaling is unavailable because REDIS_URL/KV_URL is not configured.",
      },
      { status: 503 },
    );
  }

  const publisher = createRedisClient("stop-signal-publisher");
  try {
    await publisher.publish(`stop:${chatId}`, "stop");
  } catch (error) {
    console.error(
      `[redis] Failed to publish stop signal for chat ${chatId}:`,
      error,
    );
    return Response.json(
      { error: "Failed to publish stop signal" },
      { status: 502 },
    );
  } finally {
    publisher.disconnect();
  }

  return Response.json({ success: true });
}
