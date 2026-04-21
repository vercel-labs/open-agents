import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import { forkChatThroughMessage, getChatById } from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

type ForkChatRequest = {
  messageId?: string;
  id?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  let body: ForkChatRequest;
  try {
    body = (await req.json()) as ForkChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messageId =
    typeof body.messageId === "string" ? body.messageId.trim() : "";
  if (!messageId) {
    return Response.json({ error: "A messageId is required" }, { status: 400 });
  }

  const requestedChatId =
    typeof body.id === "string" ? body.id.trim() : body.id;
  if (requestedChatId !== undefined) {
    if (typeof requestedChatId !== "string" || requestedChatId.length === 0) {
      return Response.json({ error: "Invalid chat id" }, { status: 400 });
    }

    const existingChat = await getChatById(requestedChatId);
    if (existingChat) {
      return Response.json({ error: "Chat ID conflict" }, { status: 409 });
    }
  }

  const result = await forkChatThroughMessage({
    userId: authResult.userId,
    sourceChatId: chatId,
    throughMessageId: messageId,
    forkedChat: {
      id: requestedChatId ?? crypto.randomUUID(),
      sessionId,
      title: `Fork of ${chatContext.chat.title}`,
      modelId: chatContext.chat.modelId,
    },
  });

  if (result.status === "message_not_found") {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  if (result.status === "not_assistant_message") {
    return Response.json(
      { error: "Only assistant messages can be forked" },
      { status: 400 },
    );
  }

  return Response.json({ chat: result.chat });
}
