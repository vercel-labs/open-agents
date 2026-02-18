import { nanoid } from "nanoid";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * POST /api/sessions/:sessionId/share
 * Generates a shareId for the session, making it publicly accessible.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // If already shared, return the existing shareId
  if (existingSession.shareId) {
    return Response.json({ shareId: existingSession.shareId });
  }

  const shareId = nanoid(12);
  const updated = await updateSession(sessionId, { shareId });

  if (!updated) {
    return Response.json(
      { error: "Failed to update session" },
      { status: 500 },
    );
  }

  return Response.json({ shareId });
}

/**
 * DELETE /api/sessions/:sessionId/share
 * Removes the shareId, revoking public access.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await params;
  const existingSession = await getSessionById(sessionId);

  if (!existingSession) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (existingSession.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await updateSession(sessionId, { shareId: null });

  return Response.json({ success: true });
}
