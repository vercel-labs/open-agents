import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

interface GitStatusRequest {
  sessionId: string;
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: GitStatusRequest;
  try {
    body = (await req.json()) as GitStatusRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sessionRecord.sandboxState);
    const cwd = sandbox.workingDirectory;

    // Get current branch - detect detached HEAD explicitly
    const symbolicRefResult = await sandbox.exec(
      "git symbolic-ref --short HEAD",
      cwd,
      10000,
    );

    let branch: string;
    let isDetachedHead = false;

    if (symbolicRefResult.success && symbolicRefResult.stdout.trim()) {
      branch = symbolicRefResult.stdout.trim();
    } else {
      // Detached HEAD - get short commit hash for display
      const revParseResult = await sandbox.exec(
        "git rev-parse --short HEAD",
        cwd,
        10000,
      );
      branch = revParseResult.stdout.trim();
      isDetachedHead = true;
    }

    // Check for uncommitted changes
    const statusResult = await sandbox.exec(
      "git status --porcelain",
      cwd,
      10000,
    );
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    // Count uncommitted files
    const uncommittedFiles = statusResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0).length;

    return Response.json({
      branch,
      isDetachedHead,
      hasUncommittedChanges,
      uncommittedFiles: hasUncommittedChanges ? uncommittedFiles : 0,
    });
  } catch (error) {
    console.error("Failed to get git status:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
