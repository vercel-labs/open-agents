/**
 * Deprecated endpoint.
 * Sharing is now chat-scoped at /api/sessions/:sessionId/chats/:chatId/share.
 */
export async function POST() {
  return Response.json(
    {
      error:
        "Session-level sharing is deprecated. Use /api/sessions/:sessionId/chats/:chatId/share.",
    },
    { status: 410 },
  );
}

/**
 * Deprecated endpoint.
 * Sharing is now chat-scoped at /api/sessions/:sessionId/chats/:chatId/share.
 */
export async function DELETE() {
  return Response.json(
    {
      error:
        "Session-level sharing is deprecated. Use /api/sessions/:sessionId/chats/:chatId/share.",
    },
    { status: 410 },
  );
}
