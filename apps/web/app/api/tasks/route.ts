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
  isNewBranch?: boolean;
}

function generateBranchName(username: string, name?: string | null): string {
  let initials = "nb"; // fallback
  if (name) {
    // "Nico Albanese" -> "na"
    initials =
      name
        .split(" ")
        .map((n) => n[0]?.toLowerCase() ?? "")
        .join("")
        .slice(0, 2) || "nb";
  } else if (username) {
    // "nicoalbanese" -> "ni"
    initials = username.slice(0, 2).toLowerCase();
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
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

  const {
    title,
    repoOwner,
    repoName,
    branch,
    cloneUrl,
    sandboxId,
    isNewBranch,
  } = body;

  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  // Generate branch name if creating a new branch
  let finalBranch = branch;
  if (isNewBranch) {
    finalBranch = generateBranchName(session.user.username, session.user.name);
  }

  try {
    const task = await createTask({
      id: nanoid(),
      userId: session.user.id,
      title,
      status: "running",
      repoOwner,
      repoName,
      branch: finalBranch,
      cloneUrl,
      sandboxId,
      isNewBranch: isNewBranch ?? false,
    });

    return Response.json({ task });
  } catch (error) {
    console.error("Failed to create task:", error);
    return Response.json({ error: "Failed to create task" }, { status: 500 });
  }
}
