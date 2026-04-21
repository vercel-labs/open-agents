import { posix } from "node:path";
import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearUnavailableSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";

export type WorkspaceFileContentResponse = {
  path: string;
  content: string;
  size: number;
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const MAX_FILE_PREVIEW_BYTES = 200_000;

function normalizeRequestedFilePath(rawPath: string | null): string | null {
  if (!rawPath) {
    return null;
  }

  const trimmedPath = rawPath.trim();
  if (!trimmedPath || trimmedPath.includes("\0")) {
    return null;
  }

  const normalizedPath = posix.normalize(trimmedPath.replaceAll("\\", "/"));
  if (
    !normalizedPath ||
    normalizedPath === "." ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    posix.isAbsolute(normalizedPath)
  ) {
    return null;
  }

  return normalizedPath;
}

function isMissingFileError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("enoent") ||
    normalizedMessage.includes("no such file") ||
    normalizedMessage.includes("not found")
  );
}

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const requestedPath = new URL(req.url).searchParams.get("path");
  const filePath = normalizeRequestedFilePath(requestedPath);
  if (!filePath) {
    return Response.json({ error: "Invalid file path" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: hasRuntimeSandboxState,
    sandboxErrorMessage: "Sandbox not initialized",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const fullPath = posix.join(sandbox.workingDirectory, filePath);
    const stats = await sandbox.stat(fullPath);

    if (!stats.isFile()) {
      return Response.json(
        {
          error: stats.isDirectory()
            ? "Directories cannot be previewed"
            : "Only regular files can be previewed",
        },
        { status: 400 },
      );
    }

    if (stats.size > MAX_FILE_PREVIEW_BYTES) {
      return Response.json(
        { error: "File is too large to preview" },
        { status: 413 },
      );
    }

    const content = await sandbox.readFile(fullPath, "utf-8");
    if (content.includes("\0")) {
      return Response.json(
        { error: "Binary files cannot be previewed" },
        { status: 400 },
      );
    }

    const response: WorkspaceFileContentResponse = {
      path: filePath,
      content,
      size: stats.size,
    };

    return Response.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearUnavailableSandboxState(
          sessionRecord.sandboxState,
          message,
        ),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        { error: "Sandbox is unavailable. Please resume sandbox." },
        { status: 409 },
      );
    }

    if (isMissingFileError(message)) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    console.error("Failed to load workspace file:", error);
    return Response.json(
      { error: "Failed to load workspace file" },
      { status: 500 },
    );
  }
}
