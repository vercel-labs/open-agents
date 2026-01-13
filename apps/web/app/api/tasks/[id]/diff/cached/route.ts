import { getTaskById } from "@/lib/db/tasks";
import { getServerSession } from "@/lib/session/get-server-session";
import type { DiffResponse } from "../route";

type RouteContext = {
  params: Promise<{ id: string }>;
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

  const { id: taskId } = await context.params;

  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!task.cachedDiff) {
    return Response.json(
      { error: "No cached diff available" },
      { status: 404 },
    );
  }

  // Note: cachedDiff is stored as jsonb and cast to DiffResponse without runtime validation.
  // This is safe as long as the schema is only written by our own diff route.
  const response: CachedDiffResponse = {
    data: task.cachedDiff as DiffResponse,
    cachedAt:
      task.cachedDiffUpdatedAt?.toISOString() ?? new Date().toISOString(),
    isStale: true,
  };

  return Response.json(response);
}
