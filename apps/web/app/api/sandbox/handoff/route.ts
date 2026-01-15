/**
 * Sandbox Handoff Endpoint - Milestone 4
 *
 * Performs seamless handoff from JustBash to Vercel, replaying pending operations.
 *
 * POST /api/sandbox/handoff
 * - Requires Vercel to be ready (status: "ready")
 * - Replays all pending operations to Vercel
 * - Updates task to use Vercel (clears JustBash state)
 *
 * GET /api/sandbox/handoff?taskId=xxx
 * - Returns handoff eligibility status
 */

import { NextResponse } from "next/server";
import { connectVercelSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { getUserGitHubToken } from "@/lib/github/user-token";
import type { PendingOperation } from "@/lib/sandbox/hybrid-sandbox";

interface HandoffRequest {
  taskId: string;
}

interface HandoffResponse {
  success: boolean;
  taskId: string;
  operationsReplayed: number;
  errors: string[];
  timing: {
    connectMs: number;
    replayMs: number;
    totalMs: number;
  };
  sandboxId: string;
}

interface StatusResponse {
  taskId: string;
  canHandoff: boolean;
  reason?: string;
  currentMode: "justbash" | "vercel" | "none";
  vercelStatus: "none" | "starting" | "ready" | "failed";
  pendingOperationsCount: number;
}

/**
 * GET: Check if handoff is possible for a task
 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { error: "taskId query parameter required" },
      { status: 400 },
    );
  }

  const task = await getTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Determine current mode
  let currentMode: "justbash" | "vercel" | "none" = "none";
  if (
    task.sandboxMode === "vercel" ||
    (!task.justBashSnapshot && task.sandboxId)
  ) {
    currentMode = "vercel";
  } else if (task.justBashSnapshot) {
    currentMode = "justbash";
  }

  const vercelStatus =
    (task.vercelStatus as "starting" | "ready" | "failed") ?? "none";
  const pendingOps = (task.pendingOperations as PendingOperation[]) ?? [];

  // Check if handoff is possible
  let canHandoff = false;
  let reason: string | undefined;

  if (currentMode === "vercel") {
    reason = "Already on Vercel";
  } else if (currentMode === "none") {
    reason = "No sandbox initialized";
  } else if (vercelStatus !== "ready") {
    reason = `Vercel not ready (status: ${vercelStatus})`;
  } else if (!task.sandboxId) {
    reason = "Vercel sandboxId not available";
  } else {
    canHandoff = true;
  }

  const response: StatusResponse = {
    taskId,
    canHandoff,
    reason,
    currentMode,
    vercelStatus,
    pendingOperationsCount: pendingOps.length,
  };

  return NextResponse.json(response);
}

/**
 * POST: Perform handoff from JustBash to Vercel
 *
 * Requirements:
 * - Task must be on JustBash mode
 * - Vercel must be ready (vercelStatus: "ready")
 * - sandboxId must be available
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as HandoffRequest;
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Validate handoff prerequisites
    if (task.sandboxMode === "vercel") {
      return NextResponse.json(
        { error: "Task already using Vercel sandbox" },
        { status: 409 },
      );
    }
    if (!task.justBashSnapshot) {
      return NextResponse.json(
        { error: "No JustBash snapshot to handoff from" },
        { status: 400 },
      );
    }
    if (task.vercelStatus !== "ready") {
      return NextResponse.json(
        { error: `Vercel not ready (status: ${task.vercelStatus ?? "none"})` },
        { status: 400 },
      );
    }
    if (!task.sandboxId) {
      return NextResponse.json(
        { error: "Vercel sandboxId not available" },
        { status: 400 },
      );
    }

    // Get GitHub token for Vercel connection
    const githubToken = await getUserGitHubToken();

    // Connect to Vercel sandbox
    const connectStartTime = Date.now();
    const vercelSandbox = await connectVercelSandbox({
      sandboxId: task.sandboxId,
      env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
    });
    const connectMs = Date.now() - connectStartTime;

    // Replay pending operations
    const replayStartTime = Date.now();
    const pendingOps = (task.pendingOperations as PendingOperation[]) ?? [];
    const errors: string[] = [];
    let operationsReplayed = 0;

    for (const op of pendingOps) {
      try {
        if (op.type === "mkdir") {
          await vercelSandbox.mkdir(op.path, { recursive: op.recursive });
          operationsReplayed++;
        } else if (op.type === "writeFile") {
          await vercelSandbox.writeFile(op.path, op.content, "utf-8");
          operationsReplayed++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to replay ${op.type} for ${op.path}: ${message}`);
      }
    }
    const replayMs = Date.now() - replayStartTime;

    // Update task to Vercel mode
    await updateTask(taskId, {
      sandboxMode: "vercel",
      // Clear JustBash state (no longer needed)
      justBashSnapshot: null,
      pendingOperations: null,
    });

    const response: HandoffResponse = {
      success: errors.length === 0,
      taskId,
      operationsReplayed,
      errors,
      timing: {
        connectMs,
        replayMs,
        totalMs: Date.now() - startTime,
      },
      sandboxId: task.sandboxId,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Handoff error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
