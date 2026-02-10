import { after } from "next/server";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import {
  getChatById,
  getSessionById,
  updateChatActiveStreamId,
} from "@/lib/db/sessions";
import { resumableStreamContext } from "@/lib/resumable-stream-context";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const { chatId } = await context.params;

  const chat = await getChatById(chatId);
  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  // Verify ownership through the session chain
  const sessionRecord = await getSessionById(chat.sessionId);
  if (!sessionRecord || sessionRecord.userId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!chat.activeStreamId) {
    return new Response(null, { status: 204 });
  }

  const stream = await resumableStreamContext.resumeExistingStream(
    chat.activeStreamId,
  );

  if (!stream) {
    // Stream no longer exists in Redis (expired or finished) — clear the stale
    // activeStreamId so future page loads don't attempt another resume.
    after(updateChatActiveStreamId(chatId, null));
    return new Response(null, { status: 204 });
  }

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
