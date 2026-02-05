import { getSessionById } from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";
import type { DiffResponse } from "../route";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type CachedDiffResponse = {
  data: DiffResponse;
  cachedAt: string;
  isStale: true;
};

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!sessionRecord.cachedDiff) {
    return Response.json(
      { error: "No cached diff available" },
      { status: 404 },
    );
  }

  // Note: cachedDiff is stored as jsonb and cast to DiffResponse without runtime validation.
  // This is safe as long as the schema is only written by our own diff route.
  const response: CachedDiffResponse = {
    data: sessionRecord.cachedDiff as DiffResponse,
    cachedAt:
      sessionRecord.cachedDiffUpdatedAt?.toISOString() ??
      new Date().toISOString(),
    isStale: true,
  };

  return Response.json(response);
}
