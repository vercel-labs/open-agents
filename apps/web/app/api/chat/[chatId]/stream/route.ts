import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { after } from "next/server";
import {
  requireAuthenticatedUser,
  requireOwnedChatById,
} from "@/app/api/chat/_lib/chat-context";
import { updateChatActiveStreamId } from "@/lib/db/sessions";
import { resumableStreamContext } from "@/lib/resumable-stream-context";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser("text");
  if (!authResult.ok) {
    return authResult.response;
  }

  const { chatId } = await context.params;

  const chatContext = await requireOwnedChatById({
    userId: authResult.userId,
    chatId,
    format: "text",
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { chat } = chatContext;

  if (!chat.activeStreamId) {
    return new Response(null, { status: 204 });
  }

  const stream = await resumableStreamContext.resumeExistingStream(
    chat.activeStreamId,
  );

  if (!stream) {
    // Stream no longer exists in Redis (expired or finished) — clear the stale
    // activeStreamId so future page loads don't attempt another resume.
    after(async () => {
      await updateChatActiveStreamId(chatId, null);
    });
    return new Response(null, { status: 204 });
  }

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
