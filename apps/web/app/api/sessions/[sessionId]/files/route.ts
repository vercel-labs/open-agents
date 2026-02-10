import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type FileSuggestion = {
  value: string;
  display: string;
  isDirectory: boolean;
};

export type FilesResponse = {
  files: FileSuggestion[];
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Parse git ls-files output and extract files and directories
 */
function parseGitFiles(output: string): FileSuggestion[] {
  const results: FileSuggestion[] = [];
  const seenDirs = new Set<string>();

  const files = output.trim().split("\n").filter(Boolean);

  for (const file of files) {
    // Add parent directories
    const parts = file.split("/");
    let dirPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;
      dirPath = dirPath ? `${dirPath}/${part}` : part;
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath);
        results.push({
          value: `${dirPath}/`,
          display: `${dirPath}/`,
          isDirectory: true,
        });
      }
    }

    // Add the file
    results.push({
      value: file,
      display: file,
      isDirectory: false,
    });
  }

  // Sort: directories first, then alphabetically
  results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.display.localeCompare(b.display);
  });

  return results;
}

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasRuntimeSandboxState(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    // Run git commands sequentially; some sandbox backends are not reliable
    // with concurrent command streams after reconnect.
    const trackedResult = await sandbox.exec("git ls-files", cwd, 30000);
    const untrackedResult = await sandbox.exec(
      "git ls-files --others --exclude-standard",
      cwd,
      30000,
    );

    if (!trackedResult.success) {
      const stderr = trackedResult.stderr ?? "";
      if (isSandboxUnavailableError(stderr)) {
        await updateSession(sessionId, {
          sandboxState: clearSandboxState(sessionRecord.sandboxState),
          ...buildHibernatedLifecycleUpdate(),
        });
        return Response.json(
          { error: "Sandbox is unavailable. Please resume sandbox." },
          { status: 409 },
        );
      }
      console.error("Git ls-files failed:", trackedResult.stderr);
      return Response.json(
        { error: "Failed to list files. Ensure this is a git repository." },
        { status: 400 },
      );
    }

    if (!untrackedResult.success) {
      const stderr = untrackedResult.stderr ?? "";
      if (isSandboxUnavailableError(stderr)) {
        await updateSession(sessionId, {
          sandboxState: clearSandboxState(sessionRecord.sandboxState),
          ...buildHibernatedLifecycleUpdate(),
        });
        return Response.json(
          { error: "Sandbox is unavailable. Please resume sandbox." },
          { status: 409 },
        );
      }
    }

    // Combine tracked and untracked files
    const trackedFiles = trackedResult.stdout.trim();
    const untrackedFiles = untrackedResult.success
      ? untrackedResult.stdout.trim()
      : "";

    const combinedOutput = [trackedFiles, untrackedFiles]
      .filter(Boolean)
      .join("\n");

    const files = parseGitFiles(combinedOutput);

    // Limit to 500 files for performance
    const limitedFiles = files.slice(0, 500);

    const response: FilesResponse = {
      files: limitedFiles,
    };

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearSandboxState(sessionRecord.sandboxState),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        { error: "Sandbox is unavailable. Please resume sandbox." },
        { status: 409 },
      );
    }
    console.error("Failed to list files:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
