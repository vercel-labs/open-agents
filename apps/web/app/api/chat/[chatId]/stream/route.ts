import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { getRun } from "workflow/api";
import {
  requireAuthenticatedUser,
  requireOwnedChatById,
} from "@/app/api/chat/_lib/chat-context";
import type { WebAgentUIMessage } from "@/app/types";
import { updateChatActiveStreamId } from "@/lib/db/sessions";
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

type WebAgentUIMessageChunk = InferUIMessageChunk<WebAgentUIMessage>;

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

  const runId = chat.activeStreamId;

  try {
    const run = getRun(runId);
    const status = await run.status;

    if (
      status === "completed" ||
      status === "cancelled" ||
      status === "failed"
    ) {
      // Workflow is done — clear the stale activeStreamId.
      await updateChatActiveStreamId(chatId, null);
      return new Response(null, { status: 204 });
    }

    const stream = createCancelableReadableStream(
      run.getReadable<WebAgentUIMessageChunk>(),
    );

    return createUIMessageStreamResponse({ stream });
  } catch {
    // Workflow run not found or inaccessible — clear stale ID.
    await updateChatActiveStreamId(chatId, null);
    return new Response(null, { status: 204 });
  }
}
