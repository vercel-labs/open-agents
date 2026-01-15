/**
 * Vercel Background Startup Endpoint
 *
 * Starts Vercel sandbox creation in a serverless-friendly way.
 * Designed for Hybrid Sandbox Milestone 3 - background Vercel startup.
 *
 * POST /api/sandbox/vercel-background
 * - Starts Vercel sandbox for a task (blocks until complete)
 * - Updates task with sandboxId and status
 * - Client can fire-and-forget this call
 *
 * GET /api/sandbox/vercel-background?taskId=xxx
 * - Returns current Vercel startup status for the task
 */

import { NextResponse } from "next/server";
import { connectVercelSandbox } from "@open-harness/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { getUserGitHubToken } from "@/lib/github/user-token";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

interface StartRequest {
  taskId: string;
}

interface StartResponse {
  success: true;
  taskId: string;
  sandboxId: string;
  status: "ready";
  timing: {
    startMs: number;
  };
}

interface StatusResponse {
  taskId: string;
  status: "none" | "starting" | "ready" | "failed";
  sandboxId?: string;
  startedAt?: string;
  error?: string;
}

/**
 * GET: Check Vercel startup status for a task
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

  const response: StatusResponse = {
    taskId,
    status: (task.vercelStatus as StatusResponse["status"]) ?? "none",
    sandboxId: task.sandboxId ?? undefined,
    startedAt: task.vercelStartedAt?.toISOString(),
    error: task.vercelError ?? undefined,
  };

  return NextResponse.json(response);
}

/**
 * POST: Start Vercel sandbox creation for a task
 *
 * This endpoint blocks until Vercel is ready. The client can fire-and-forget
 * this call by not awaiting the response.
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as StartRequest;
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

    // Check if already starting or ready
    if (task.vercelStatus === "starting") {
      return NextResponse.json(
        { error: "Vercel already starting" },
        { status: 409 },
      );
    }
    if (task.vercelStatus === "ready" && task.sandboxId) {
      return NextResponse.json({
        success: true,
        taskId,
        sandboxId: task.sandboxId,
        status: "ready",
        timing: { startMs: 0 },
        alreadyReady: true,
      });
    }

    // Validate task has repo info
    if (!task.cloneUrl) {
      return NextResponse.json(
        { error: "Task has no repository URL" },
        { status: 400 },
      );
    }

    // Mark as starting
    await updateTask(taskId, {
      vercelStatus: "starting",
      vercelStartedAt: new Date(),
      vercelError: null,
    });

    // Get GitHub token and session for git config
    const githubToken = await getUserGitHubToken();
    if (!githubToken) {
      await updateTask(taskId, {
        vercelStatus: "failed",
        vercelError: "GitHub not connected",
      });
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 401 },
      );
    }

    // Start Vercel sandbox (this blocks)
    const sandbox = await connectVercelSandbox({
      timeout: DEFAULT_TIMEOUT,
      gitUser: {
        name: session.user.name ?? session.user.username,
        email:
          session.user.email ??
          `${session.user.username}@users.noreply.github.com`,
      },
      env: {
        GITHUB_TOKEN: githubToken,
      },
      source: {
        url: task.cloneUrl,
        token: githubToken,
        ...(task.isNewBranch
          ? { newBranch: task.branch ?? "main" }
          : { branch: task.branch ?? "main" }),
      },
    });

    // Mark as ready and store sandboxId
    const sandboxCreatedAt = new Date();
    await updateTask(taskId, {
      vercelStatus: "ready",
      sandboxId: sandbox.id,
      sandboxCreatedAt,
      sandboxTimeout: DEFAULT_TIMEOUT,
    });

    const response: StartResponse = {
      success: true,
      taskId,
      sandboxId: sandbox.id,
      status: "ready",
      timing: {
        startMs: Date.now() - startTime,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Try to extract taskId for error tracking
    try {
      const body = await request.clone().json();
      if (body.taskId) {
        await updateTask(body.taskId, {
          vercelStatus: "failed",
          vercelError: message,
        });
      }
    } catch {
      // Ignore if we can't extract taskId
    }

    console.error("Vercel background startup error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
