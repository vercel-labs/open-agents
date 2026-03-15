import {
  requireAuthenticatedUser,
  requireOwnedChatById,
} from "@/app/api/chat/_lib/chat-context";
import {
  createRedisClient,
  isRedisConfigured,
  warnRedisDisabled,
} from "@/lib/redis";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { chatId } = await context.params;

  const chatContext = await requireOwnedChatById({
    userId: authResult.userId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
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
