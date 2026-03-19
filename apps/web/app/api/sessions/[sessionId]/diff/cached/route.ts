import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
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
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

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
