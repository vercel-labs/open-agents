import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById } from "@/lib/db/tasks";
import { getTaskMessages, createTaskMessage } from "@/lib/db/tasks";
import { nanoid } from "nanoid";

interface CreateMessageRequest {
  role: "user" | "assistant";
  parts: unknown;
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

  const messages = await getTaskMessages(id);
  return Response.json({ messages });
}

export async function POST(
  req: Request,
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

  let body: CreateMessageRequest;
  try {
    body = (await req.json()) as CreateMessageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { role, parts } = body;

  if (!role || !parts) {
    return Response.json(
      { error: "role and parts are required" },
      { status: 400 },
    );
  }

  if (!["user", "assistant"].includes(role)) {
    return Response.json(
      { error: "role must be 'user' or 'assistant'" },
      { status: 400 },
    );
  }

  const message = await createTaskMessage({
    id: nanoid(),
    taskId: id,
    role,
    parts,
  });

  return Response.json({ message });
}
