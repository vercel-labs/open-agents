/**
 * Hybrid Sandbox Milestone 3 Test Endpoint
 *
 * Tests background Vercel startup while JustBash handles initial requests.
 *
 * Flow:
 * 1. Create task with repo info
 * 2. Initialize JustBash immediately (fast)
 * 3. Trigger background Vercel startup (fire-and-forget)
 * 4. Poll for Vercel readiness
 * 5. Validate both sandboxes are operational
 *
 * POST /api/test/hybrid-background
 * Body: { repoUrl: string, branch?: string }
 */

import { NextResponse } from "next/server";
import {
  createJustBashSandbox,
  connectVercelSandbox,
  JustBashSandbox,
} from "@open-harness/sandbox";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, users } from "@/lib/db/schema";
import { updateTask, deleteTask } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";
import { decrypt } from "@/lib/crypto";
import { nanoid } from "nanoid";

const WORKING_DIR = "/vercel/sandbox";
const DEFAULT_TIMEOUT = 300_000;

interface TestRequest {
  repoUrl: string;
  branch?: string;
  cleanup?: boolean; // Whether to cleanup after test (default: true)
  token?: string; // Optional GitHub token override
}

interface TestResult {
  success: boolean;
  taskId: string;
  metrics: {
    justBashReadyMs: number;
    vercelStartTriggeredMs: number;
    vercelReadyMs: number;
    totalMs: number;
    timeToFirstInteraction: number;
    timeSavedMs: number;
  };
  justBash: {
    fileCount: number;
    snapshotSizeBytes: number;
    canRead: boolean;
    canWrite: boolean;
  };
  vercel: {
    sandboxId: string;
    canRead: boolean;
    canExecGit: boolean;
  };
  timeline: Array<{ event: string; ms: number }>;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const timeline: Array<{ event: string; ms: number }> = [];
  const addEvent = (event: string) =>
    timeline.push({ event, ms: Date.now() - startTime });

  addEvent("test_started");

  let taskId: string | null = null;
  let justBashSandbox: JustBashSandbox | null = null;

  try {
    // 1. Parse request
    const body = (await request.json()) as TestRequest;
    const { repoUrl, branch = "main", cleanup = true, token } = body;

    if (!repoUrl) {
      return NextResponse.json(
        { error: "repoUrl is required" },
        { status: 400 },
      );
    }

    // 2. Find a GitHub user (test endpoint - no auth required)
    const existingUser = await db.query.users.findFirst({
      where: eq(users.provider, "github"),
    });
    if (!existingUser) {
      return NextResponse.json(
        { error: "No GitHub users found. Please log in via GitHub first." },
        { status: 400 },
      );
    }
    addEvent("user_found");

    // 3. Get GitHub token from user or request body (decrypt if from DB)
    // Token is optional for public repos - if decryption fails, continue without
    let githubToken: string | undefined;
    if (token) {
      githubToken = token;
    } else {
      try {
        const decrypted = decrypt(existingUser.accessToken);
        // Verify the token looks valid (not empty or corrupted)
        if (decrypted && decrypted.length > 10) {
          githubToken = decrypted;
        }
      } catch {
        // Token decryption failed, try without token for public repos
        console.log("Token decryption failed, proceeding without token");
      }
    }
    addEvent("github_token_retrieved");

    // 4. Create test task
    const [task] = await db
      .insert(tasks)
      .values({
        id: `test-m3-${nanoid(8)}`,
        userId: existingUser.id,
        title: `[Test M3] ${repoUrl}`,
        cloneUrl: repoUrl,
        branch,
        status: "running",
      })
      .returning();

    if (!task) {
      return NextResponse.json(
        { error: "Failed to create task" },
        { status: 500 },
      );
    }
    taskId = task.id;
    addEvent("task_created");

    // ============================================
    // PHASE 1: JustBash initialization (instant)
    // ============================================

    const justBashStartTime = Date.now();

    // Download tarball (try without token first for public repos)
    // GitHub API rate limits are higher with a valid token, but public repos work without
    let tarballResult;
    try {
      // First try with token
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        githubToken,
        WORKING_DIR,
      );
    } catch (tokenError) {
      // If token fails (403/401), try without token for public repos
      addEvent("tarball_token_failed_retrying_without");
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        undefined,
        WORKING_DIR,
      );
    }
    addEvent("tarball_downloaded");

    // Create JustBash sandbox
    justBashSandbox = await createJustBashSandbox({
      workingDirectory: WORKING_DIR,
      files: tarballResult.files,
      mode: "memory",
    });
    addEvent("justbash_created");

    // Serialize and persist
    const snapshot = justBashSandbox.serialize();
    const snapshotJson = JSON.stringify(snapshot);
    const snapshotSizeBytes = Buffer.byteLength(snapshotJson, "utf-8");

    await updateTask(taskId, {
      justBashSnapshot: snapshot,
    });
    addEvent("justbash_persisted");

    const justBashReadyMs = Date.now() - justBashStartTime;

    // Test JustBash capabilities
    let justBashCanRead = false;
    try {
      await justBashSandbox.readFile(`${WORKING_DIR}/package.json`, "utf-8");
      justBashCanRead = true;
    } catch {
      // File not found or error
    }
    addEvent("justbash_read_tested");

    // Test JustBash write
    let justBashCanWrite = false;
    try {
      await justBashSandbox.writeFile(
        `${WORKING_DIR}/test-m3.txt`,
        "Milestone 3 test file",
        "utf-8",
      );
      const content = await justBashSandbox.readFile(
        `${WORKING_DIR}/test-m3.txt`,
        "utf-8",
      );
      justBashCanWrite = content.includes("Milestone 3");
    } catch {
      // Write or read failed
    }
    addEvent("justbash_write_tested");

    // ============================================
    // PHASE 2: Background Vercel startup
    // ============================================

    // Mark Vercel as starting
    await updateTask(taskId, {
      vercelStatus: "starting",
      vercelStartedAt: new Date(),
    });
    addEvent("vercel_start_marked");

    const vercelStartTriggeredMs = Date.now() - startTime;

    // In a real scenario, this would be fire-and-forget.
    // For the test, we await it but measure the timing.
    const vercelStartTime = Date.now();

    const vercelSandbox = await connectVercelSandbox({
      timeout: DEFAULT_TIMEOUT,
      gitUser: {
        name: existingUser.name ?? existingUser.username,
        email:
          existingUser.email ??
          `${existingUser.username}@users.noreply.github.com`,
      },
      env: {
        GITHUB_TOKEN: githubToken,
      },
      source: {
        url: repoUrl,
        token: githubToken,
        branch,
      },
    });
    addEvent("vercel_ready");

    const vercelReadyMs = Date.now() - vercelStartTime;

    // Update task with Vercel info
    await updateTask(taskId, {
      vercelStatus: "ready",
      sandboxId: vercelSandbox.id,
      sandboxCreatedAt: new Date(),
      sandboxTimeout: DEFAULT_TIMEOUT,
    });
    addEvent("vercel_persisted");

    // Test Vercel capabilities
    let vercelCanRead = false;
    try {
      await vercelSandbox.readFile(
        `${vercelSandbox.workingDirectory}/package.json`,
        "utf-8",
      );
      vercelCanRead = true;
    } catch {
      // File not found or error
    }
    addEvent("vercel_read_tested");

    // Test git (Vercel-only capability)
    const gitResult = await vercelSandbox.exec(
      "git status",
      vercelSandbox.workingDirectory,
      30000,
    );
    const vercelCanExecGit = gitResult.exitCode === 0;
    addEvent("vercel_git_tested");

    // ============================================
    // RESULTS
    // ============================================

    const totalMs = Date.now() - startTime;

    // Cleanup if requested
    if (cleanup) {
      await vercelSandbox.stop();
      await deleteTask(taskId);
      addEvent("cleanup_complete");
    }

    const result: TestResult = {
      success: true,
      taskId,
      metrics: {
        justBashReadyMs,
        vercelStartTriggeredMs,
        vercelReadyMs,
        totalMs,
        timeToFirstInteraction: justBashReadyMs,
        timeSavedMs: vercelReadyMs - justBashReadyMs,
      },
      justBash: {
        fileCount: Object.keys(snapshot.files).length,
        snapshotSizeBytes,
        canRead: justBashCanRead,
        canWrite: justBashCanWrite,
      },
      vercel: {
        sandboxId: vercelSandbox.id,
        canRead: vercelCanRead,
        canExecGit: vercelCanExecGit,
      },
      timeline,
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addEvent(`error: ${message}`);

    // Cleanup on error
    if (taskId) {
      try {
        await deleteTask(taskId);
      } catch {
        // Ignore cleanup errors
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: message,
        timeline,
      },
      { status: 500 },
    );
  }
}
