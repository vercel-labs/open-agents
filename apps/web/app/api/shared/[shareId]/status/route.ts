import { getSharedChatStatus } from "./get-shared-chat-status";

type RouteContext = {
  params: Promise<{ shareId: string }>;
};

/**
 * GET /api/shared/:shareId/status
 * Public read-only endpoint returning streaming status for a shared chat.
 * Returns { isStreaming } or 404 if the share is invalid.
 */
export async function GET(_req: Request, context: RouteContext) {
  const { shareId } = await context.params;
  const status = await getSharedChatStatus(shareId);

  if (!status) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(status);
}
