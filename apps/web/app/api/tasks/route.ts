import { getServerSession } from "@/lib/session/get-server-session";
import { createTask, getTasksByUserId } from "@/lib/db/tasks";
import { nanoid } from "nanoid";

interface CreateTaskRequest {
  title: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  sandboxId?: string;
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tasks = await getTasksByUserId(session.user.id);
  return Response.json({ tasks });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CreateTaskRequest;
  try {
    body = (await req.json()) as CreateTaskRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, repoOwner, repoName, branch, cloneUrl, sandboxId } = body;

  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const task = await createTask({
    id: nanoid(),
    userId: session.user.id,
    title,
    status: "running",
    repoOwner,
    repoName,
    branch,
    cloneUrl,
    sandboxId,
  });

  return Response.json({ task });
}
