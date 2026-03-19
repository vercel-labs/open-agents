import { nanoid } from "nanoid";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import {
  createShareIfNotExists,
  deleteShareByChatId,
  getShareByChatId,
} from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

/**
 * GET /api/sessions/:sessionId/chats/:chatId/share
 * Returns the existing share link id for this chat, if present.
 */
export async function GET(_req: Request, context: RouteContext) {
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

  const share = await getShareByChatId(chatId);
  return Response.json({ shareId: share?.id ?? null });
}

/**
 * POST /api/sessions/:sessionId/chats/:chatId/share
 * Generates a share id for a single chat, making only that chat publicly accessible.
 */
export async function POST(_req: Request, context: RouteContext) {
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

  await deleteShareByChatId(chatId);
  return Response.json({ success: true });
}
