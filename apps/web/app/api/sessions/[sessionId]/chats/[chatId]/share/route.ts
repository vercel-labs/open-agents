import { nanoid } from "nanoid";
import {
  createShareIfNotExists,
  deleteShareByChatId,
  getChatById,
  getSessionById,
  getShareByChatId,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

async function validateOwnedChat(
  sessionId: string,
  chatId: string,
  userId: string,
): Promise<
  | { ok: true }
  | {
      ok: false;
      response: Response;
    }
> {
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return {
      ok: false,
      response: Response.json({ error: "Session not found" }, { status: 404 }),
    };
  }

  if (sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const existingChat = await getChatById(chatId);
  if (!existingChat || existingChat.sessionId !== sessionId) {
    return {
      ok: false,
      response: Response.json({ error: "Chat not found" }, { status: 404 }),
    };
  }

  return { ok: true };
}

/**
 * GET /api/sessions/:sessionId/chats/:chatId/share
 * Returns the existing share link id for this chat, if present.
 */
export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, chatId } = await context.params;
  const validation = await validateOwnedChat(
    sessionId,
    chatId,
    session.user.id,
  );
  if (!validation.ok) {
    return validation.response;
  }

  const share = await getShareByChatId(chatId);
  return Response.json({ shareId: share?.id ?? null });
}

/**
 * POST /api/sessions/:sessionId/chats/:chatId/share
 * Generates a share id for a single chat, making only that chat publicly accessible.
 */
export async function POST(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, chatId } = await context.params;
  const validation = await validateOwnedChat(
    sessionId,
    chatId,
    session.user.id,
  );
  if (!validation.ok) {
    return validation.response;
  }

  const existingShare = await getShareByChatId(chatId);
  if (existingShare) {
    return Response.json({ shareId: existingShare.id });
  }

  const createdShare = await createShareIfNotExists({
    id: nanoid(12),
    chatId,
  });

  if (!createdShare) {
    return Response.json({ error: "Failed to create share" }, { status: 500 });
  }

  return Response.json({ shareId: createdShare.id });
}

/**
 * DELETE /api/sessions/:sessionId/chats/:chatId/share
 * Revokes public access for this chat share link.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, chatId } = await context.params;
  const validation = await validateOwnedChat(
    sessionId,
    chatId,
    session.user.id,
  );
  if (!validation.ok) {
    return validation.response;
  }

  await deleteShareByChatId(chatId);
  return Response.json({ success: true });
}
