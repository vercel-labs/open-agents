import { after } from "next/server";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getRun } from "workflow/api";
import {
  getChatById,
  getSessionById,
  updateChatActiveStreamId,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
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

  const runId = chat.activeStreamId;
  if (!runId) {
    return new Response(null, { status: 204 });
  }

  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get("startIndex");
  const startIndex =
    startIndexParam && Number.isFinite(Number(startIndexParam))
      ? Number.parseInt(startIndexParam, 10)
      : undefined;

  try {
    const stream = getRun(runId).getReadable<UIMessageChunk>({ startIndex });
    return createUIMessageStreamResponse({ stream });
  } catch {
    // Run no longer exists or stream unavailable; clear stale pointer.
    after(async () => {
      await updateChatActiveStreamId(chatId, null);
    });
    return new Response(null, { status: 204 });
  }
}
