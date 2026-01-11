import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask, deleteTask } from "@/lib/db/tasks";

interface UpdateTaskRequest {
  title?: string;
  status?: "running" | "completed" | "failed" | "archived";
  linesAdded?: number;
  linesRemoved?: number;
  prNumber?: number;
  prStatus?: "open" | "merged" | "closed";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const task = await getTaskById(id);

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ task });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const existingTask = await getTaskById(id);

  if (!existingTask) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (existingTask.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpdateTaskRequest;
  try {
    body = (await req.json()) as UpdateTaskRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Task existence is guaranteed by the ownership check above
  const task = await updateTask(id, body);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  return Response.json({ task });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const existingTask = await getTaskById(id);

  if (!existingTask) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  if (existingTask.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await deleteTask(id);
  return Response.json({ success: true });
}
