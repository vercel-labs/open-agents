/**
 * Hybrid Sandbox Milestone 5 Test Endpoint
 *
 * Tests chat route integration with HybridSandbox:
 * 1. Task starts, agent can interact within ~1s (JustBash)
 * 2. Agent reads/writes files immediately
 * 3. Pending operations tracked across requests
 * 4. Auto-handoff to Vercel when ready
 * 5. All file changes persist after handoff
 *
 * POST /api/test/hybrid-chat
 * Body: { repoUrl: string, branch?: string }
 */

import { NextResponse } from "next/server";
import {
  createJustBashSandbox,
  connectVercelSandbox,
  JustBashSandbox,
  type JustBashSnapshot,
} from "@open-harness/sandbox";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, users } from "@/lib/db/schema";
import { updateTask, deleteTask, getTaskById } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";
import { decrypt } from "@/lib/crypto";
import { nanoid } from "nanoid";
import {
  HybridSandbox,
  type PendingOperation,
} from "@/lib/sandbox/hybrid-sandbox";

const WORKING_DIR = "/vercel/sandbox";
const DEFAULT_TIMEOUT = 300_000;

interface TestRequest {
  repoUrl: string;
  branch?: string;
  cleanup?: boolean;
  token?: string;
}

interface TestResult {
  success: boolean;
  taskId: string;
  metrics: {
    justBashReadyMs: number;
    turn1Ms: number;
    turn2Ms: number;
    vercelReadyMs: number;
    handoffMs: number;
    turn3Ms: number;
    totalMs: number;
  };
  turns: {
    turn1: {
      sandboxMode: "justbash" | "vercel";
      filesRead: number;
      filesWritten: number;
      pendingOpsCount: number;
    };
    turn2: {
      sandboxMode: "justbash" | "vercel";
      pendingOpsRestored: number;
      filesWritten: number;
      totalPendingOps: number;
    };
    turn3: {
      sandboxMode: "justbash" | "vercel";
      handoffOccurred: boolean;
      gitWorks: boolean;
    };
  };
  verification: {
    allFilesExist: boolean;
    contentMatches: boolean;
    filesChecked: Array<{
      path: string;
      exists: boolean;
      contentMatch: boolean;
    }>;
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

    // 2. Find a GitHub user
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

    // 3. Get GitHub token
    let githubToken: string | undefined;
    if (token) {
      githubToken = token;
    } else {
      try {
        const decrypted = decrypt(existingUser.accessToken);
        if (decrypted && decrypted.length > 10) {
          githubToken = decrypted;
        }
      } catch {
        console.log("Token decryption failed, proceeding without token");
      }
    }
    addEvent("github_token_retrieved");

    // 4. Create test task
    const [task] = await db
      .insert(tasks)
      .values({
        id: `test-m5-${nanoid(8)}`,
        userId: existingUser.id,
        title: `[Test M5] ${repoUrl}`,
        cloneUrl: repoUrl,
        branch,
        status: "running",
        sandboxMode: "justbash",
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

    // Test files to track throughout the test
    const testFiles: Array<{ path: string; content: string }> = [];

    // ============================================
    // PHASE 1: Initialize JustBash
    // ============================================

    const justBashStartTime = Date.now();

    // Download tarball
    let tarballResult;
    try {
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        githubToken,
        WORKING_DIR,
      );
    } catch {
      addEvent("tarball_token_failed_retrying_without");
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        undefined,
        WORKING_DIR,
      );
    }
    addEvent("tarball_downloaded");

    // Create JustBash sandbox and serialize
    const initialSandbox = await createJustBashSandbox({
      workingDirectory: WORKING_DIR,
      files: tarballResult.files,
      mode: "memory",
    });
    const initialSnapshot = initialSandbox.serialize();

    await updateTask(taskId, {
      justBashSnapshot: initialSnapshot,
      sandboxMode: "justbash",
      pendingOperations: [],
    });
    addEvent("justbash_initialized");

    const justBashReadyMs = Date.now() - justBashStartTime;

    // ============================================
    // TURN 1: Simulate first chat request (read + write)
    // ============================================

    const turn1StartTime = Date.now();
    addEvent("turn1_start");

    // Simulate chat route: restore JustBash and wrap in HybridSandbox
    const turn1Task = await getTaskById(taskId);
    if (!turn1Task) throw new Error("Task not found");

    const turn1Snapshot = turn1Task.justBashSnapshot as JustBashSnapshot;
    const turn1JustBash = await JustBashSandbox.fromSnapshot(turn1Snapshot);
    const turn1Hybrid = new HybridSandbox({
      justBash: turn1JustBash,
      pendingOperations:
        (turn1Task.pendingOperations as PendingOperation[]) ?? [],
    });

    // Agent reads README
    let filesRead = 0;
    try {
      await turn1Hybrid.readFile(`${WORKING_DIR}/README.md`, "utf-8");
      filesRead++;
    } catch {
      // README may not exist
    }

    // Agent writes a new file
    const turn1FilePath = `${WORKING_DIR}/turn1-test.txt`;
    const turn1FileContent = `Turn 1 test file\nCreated: ${new Date().toISOString()}`;
    await turn1Hybrid.writeFile(turn1FilePath, turn1FileContent, "utf-8");
    testFiles.push({ path: turn1FilePath, content: turn1FileContent });

    // Persist state (simulate onFinish)
    const turn1UpdatedSnapshot = turn1JustBash.serialize();
    await updateTask(taskId, {
      justBashSnapshot: turn1UpdatedSnapshot,
      pendingOperations: turn1Hybrid.pendingOperations,
    });
    addEvent("turn1_complete");

    const turn1Ms = Date.now() - turn1StartTime;
    const turn1Result = {
      sandboxMode: "justbash" as const,
      filesRead,
      filesWritten: 1,
      pendingOpsCount: turn1Hybrid.pendingOperations.length,
    };

    // ============================================
    // TURN 2: Simulate second chat request (more writes)
    // ============================================

    const turn2StartTime = Date.now();
    addEvent("turn2_start");

    // Simulate chat route: restore JustBash and wrap in HybridSandbox
    const turn2Task = await getTaskById(taskId);
    if (!turn2Task) throw new Error("Task not found");

    const turn2Snapshot = turn2Task.justBashSnapshot as JustBashSnapshot;
    const turn2JustBash = await JustBashSandbox.fromSnapshot(turn2Snapshot);
    const turn2ExistingOps =
      (turn2Task.pendingOperations as PendingOperation[]) ?? [];
    const turn2Hybrid = new HybridSandbox({
      justBash: turn2JustBash,
      pendingOperations: turn2ExistingOps,
    });

    // Agent creates a directory and another file
    const turn2DirPath = `${WORKING_DIR}/turn2-dir`;
    await turn2Hybrid.mkdir(turn2DirPath, { recursive: true });

    const turn2FilePath = `${turn2DirPath}/nested-file.json`;
    const turn2FileContent = JSON.stringify(
      {
        turn: 2,
        timestamp: Date.now(),
        message: "Nested file from turn 2",
      },
      null,
      2,
    );
    await turn2Hybrid.writeFile(turn2FilePath, turn2FileContent, "utf-8");
    testFiles.push({ path: turn2FilePath, content: turn2FileContent });

    // Persist state
    const turn2UpdatedSnapshot = turn2JustBash.serialize();
    await updateTask(taskId, {
      justBashSnapshot: turn2UpdatedSnapshot,
      pendingOperations: turn2Hybrid.pendingOperations,
    });
    addEvent("turn2_complete");

    const turn2Ms = Date.now() - turn2StartTime;
    const turn2Result = {
      sandboxMode: "justbash" as const,
      pendingOpsRestored: turn2ExistingOps.length,
      filesWritten: 1, // Just the nested file, mkdir doesn't count as file
      totalPendingOps: turn2Hybrid.pendingOperations.length,
    };

    // ============================================
    // PHASE: Start Vercel in background (simulated)
    // ============================================

    const vercelStartTime = Date.now();
    addEvent("vercel_start");

    await updateTask(taskId, {
      vercelStatus: "starting",
      vercelStartedAt: new Date(),
    });

    const vercelSandbox = await connectVercelSandbox({
      timeout: DEFAULT_TIMEOUT,
      gitUser: {
        name: existingUser.name ?? existingUser.username,
        email:
          existingUser.email ??
          `${existingUser.username}@users.noreply.github.com`,
      },
      env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
      source: {
        url: repoUrl,
        token: githubToken,
        branch,
      },
    });

    await updateTask(taskId, {
      vercelStatus: "ready",
      sandboxId: vercelSandbox.id,
      sandboxCreatedAt: new Date(),
      sandboxTimeout: DEFAULT_TIMEOUT,
    });
    addEvent("vercel_ready");

    const vercelReadyMs = Date.now() - vercelStartTime;

    // ============================================
    // TURN 3: Chat request that triggers handoff
    // ============================================

    const turn3StartTime = Date.now();
    addEvent("turn3_start");

    // Simulate chat route with Vercel ready
    const turn3Task = await getTaskById(taskId);
    if (!turn3Task) throw new Error("Task not found");

    // Check if Vercel is ready (simulates chat route logic)
    const vercelReady =
      turn3Task.vercelStatus === "ready" && turn3Task.sandboxId !== null;
    let handoffOccurred = false;
    let handoffMs = 0;

    if (vercelReady && turn3Task.justBashSnapshot) {
      // Perform inline handoff
      const handoffStartTime = Date.now();
      addEvent("handoff_start");

      // Replay pending operations
      const pendingOps =
        (turn3Task.pendingOperations as PendingOperation[]) ?? [];
      const errors: string[] = [];
      for (const op of pendingOps) {
        try {
          if (op.type === "mkdir") {
            await vercelSandbox.mkdir(op.path, { recursive: op.recursive });
          } else if (op.type === "writeFile") {
            await vercelSandbox.writeFile(op.path, op.content, "utf-8");
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push(`Failed to replay ${op.type} for ${op.path}: ${message}`);
        }
      }

      if (errors.length > 0) {
        console.warn("Handoff replay errors (non-fatal):", errors);
      }

      // Update task to Vercel mode
      await updateTask(taskId, {
        sandboxMode: "vercel",
        justBashSnapshot: null,
        pendingOperations: null,
      });

      handoffOccurred = true;
      handoffMs = Date.now() - handoffStartTime;
      addEvent("handoff_complete");
    }

    // Test git command (should work after handoff)
    const gitResult = await vercelSandbox.exec(
      "git status",
      vercelSandbox.workingDirectory,
      30000,
    );
    const gitWorks = gitResult.exitCode === 0;
    addEvent("turn3_complete");

    const turn3Ms = Date.now() - turn3StartTime;
    const turn3Result = {
      sandboxMode: "vercel" as const,
      handoffOccurred,
      gitWorks,
    };

    // ============================================
    // VERIFICATION: Check all files exist in Vercel
    // ============================================

    addEvent("verification_start");

    const filesChecked: Array<{
      path: string;
      exists: boolean;
      contentMatch: boolean;
    }> = [];

    for (const testFile of testFiles) {
      let exists = false;
      let contentMatch = false;

      try {
        const vercelContent = await vercelSandbox.readFile(
          testFile.path,
          "utf-8",
        );
        exists = true;
        contentMatch = vercelContent === testFile.content;
      } catch {
        // File doesn't exist
      }

      filesChecked.push({ path: testFile.path, exists, contentMatch });
    }
    addEvent("verification_complete");

    const allFilesExist = filesChecked.every((f) => f.exists);
    const contentMatches = filesChecked.every((f) => f.contentMatch);

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
      success:
        allFilesExist &&
        contentMatches &&
        handoffOccurred &&
        gitWorks &&
        turn1Result.pendingOpsCount > 0 &&
        turn2Result.totalPendingOps > turn2Result.pendingOpsRestored,
      taskId,
      metrics: {
        justBashReadyMs,
        turn1Ms,
        turn2Ms,
        vercelReadyMs,
        handoffMs,
        turn3Ms,
        totalMs,
      },
      turns: {
        turn1: turn1Result,
        turn2: turn2Result,
        turn3: turn3Result,
      },
      verification: {
        allFilesExist,
        contentMatches,
        filesChecked,
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
