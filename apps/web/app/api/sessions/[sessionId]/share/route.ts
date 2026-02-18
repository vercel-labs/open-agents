import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
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

  // Use conditional update to avoid race condition where two concurrent
  // requests both see shareId as null and overwrite each other
  const shareId = nanoid(12);
  const [updated] = await db
    .update(sessions)
    .set({ shareId, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.shareId)))
    .returning();

  if (!updated) {
    // Another request already set a shareId -- fetch and return it
    const refreshed = await getSessionById(sessionId);
    if (refreshed?.shareId) {
      return Response.json({ shareId: refreshed.shareId });
    }
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
