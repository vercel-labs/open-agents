/**
 * JustBash Sandbox Initialization Endpoint
 *
 * Creates a JustBash sandbox by downloading a GitHub repository via tarball.
 * The sandbox state is persisted to the database for restoration across
 * serverless request boundaries.
 *
 * POST /api/sandbox/justbash
 * Body: { taskId: string }
 *
 * Uses the task's cloneUrl and branch to download the repository.
 */

import { NextResponse } from "next/server";
import {
  createJustBashSandbox,
  type JustBashSnapshot,
} from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";
import { getUserGitHubToken } from "@/lib/github/user-token";

const WORKING_DIR = "/vercel/sandbox";

interface RequestBody {
  taskId: string;
}

interface JustBashInitResponse {
  success: true;
  taskId: string;
  snapshot: {
    fileCount: number;
    sizeBytes: number;
    workingDirectory: string;
  };
  timing: {
    downloadMs: number;
    extractMs: number;
    createMs: number;
    serializeMs: number;
    persistMs: number;
    totalMs: number;
  };
}

export async function POST(request: Request) {
  try {
    // 1. Validate session
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2. Parse request body
    const body = (await request.json()) as RequestBody;
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    // 3. Get task and verify ownership
    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 4. Check if task already has a JustBash snapshot
    if (task.justBashSnapshot) {
      const snapshot = task.justBashSnapshot as JustBashSnapshot;
      return NextResponse.json({
        success: true,
        taskId,
        alreadyInitialized: true,
        snapshot: {
          fileCount: Object.keys(snapshot.files).length,
          workingDirectory: snapshot.workingDirectory,
        },
      });
    }

    // 5. Validate task has repo info
    if (!task.cloneUrl) {
      return NextResponse.json(
        { error: "Task has no repository URL configured" },
        { status: 400 },
      );
    }

    const startTime = Date.now();

    // 6. Get GitHub token for authenticated requests
    const githubToken = await getUserGitHubToken();

    // 7. Download and extract tarball
    const tarballResult = await downloadAndExtractTarball(
      task.cloneUrl,
      task.branch ?? "main",
      githubToken ?? undefined,
      WORKING_DIR,
    );

    // 8. Create JustBash sandbox with extracted files
    const createStart = Date.now();
    const sandbox = await createJustBashSandbox({
      workingDirectory: WORKING_DIR,
      files: tarballResult.files,
      mode: "memory",
    });
    const createMs = Date.now() - createStart;

    // 9. Serialize the sandbox state
    const serializeStart = Date.now();
    const snapshot = sandbox.serialize();
    const serializeMs = Date.now() - serializeStart;

    const snapshotJson = JSON.stringify(snapshot);
    const snapshotSizeBytes = Buffer.byteLength(snapshotJson, "utf-8");

    // 10. Persist to database
    const persistStart = Date.now();
    await updateTask(taskId, {
      justBashSnapshot: snapshot,
    });
    const persistMs = Date.now() - persistStart;

    // 11. Stop the sandbox (it will be restored on chat requests)
    await sandbox.stop();

    const response: JustBashInitResponse = {
      success: true,
      taskId,
      snapshot: {
        fileCount: Object.keys(snapshot.files).length,
        sizeBytes: snapshotSizeBytes,
        workingDirectory: snapshot.workingDirectory,
      },
      timing: {
        downloadMs: Math.round(tarballResult.downloadMs),
        extractMs: Math.round(tarballResult.extractMs),
        createMs,
        serializeMs,
        persistMs,
        totalMs: Date.now() - startTime,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("JustBash init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
