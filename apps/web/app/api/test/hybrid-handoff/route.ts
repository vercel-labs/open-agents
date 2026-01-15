/**
 * Hybrid Sandbox Milestone 4 Test Endpoint
 *
 * Tests seamless handoff from JustBash to Vercel with write replay.
 *
 * Flow:
 * 1. Create task with repo info
 * 2. Initialize JustBash with repo
 * 3. Make modifications on JustBash (tracked as pending operations)
 * 4. Start Vercel in background
 * 5. Wait for Vercel to be ready
 * 6. Perform handoff (replay pending operations)
 * 7. Verify files exist in Vercel with correct content
 * 8. Test git/npm commands work after handoff
 *
 * POST /api/test/hybrid-handoff
 * Body: { repoUrl: string, branch?: string }
 */

import { NextResponse } from "next/server";
import {
  createJustBashSandbox,
  connectVercelSandbox,
  type JustBashSandbox,
  type JustBashSnapshot,
} from "@open-harness/sandbox";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, users } from "@/lib/db/schema";
import { updateTask, deleteTask } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";
import { decrypt } from "@/lib/crypto";
import { nanoid } from "nanoid";
import type { PendingOperation } from "@/lib/sandbox/hybrid-sandbox";

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
    vercelReadyMs: number;
    handoffMs: number;
    totalMs: number;
  };
  justBash: {
    fileCount: number;
    modificationsCount: number;
  };
  handoff: {
    operationsReplayed: number;
    errors: string[];
  };
  verification: {
    allFilesExist: boolean;
    contentMatches: boolean;
    gitWorks: boolean;
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
        id: `test-m4-${nanoid(8)}`,
        userId: existingUser.id,
        title: `[Test M4] ${repoUrl}`,
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

    // ============================================
    // PHASE 1: JustBash initialization
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

    // Create JustBash sandbox
    justBashSandbox = await createJustBashSandbox({
      workingDirectory: WORKING_DIR,
      files: tarballResult.files,
      mode: "memory",
    });
    addEvent("justbash_created");

    const justBashReadyMs = Date.now() - justBashStartTime;

    // ============================================
    // PHASE 2: Make modifications (tracked as pending operations)
    // ============================================

    const pendingOperations: PendingOperation[] = [];
    const testFiles: Array<{ path: string; content: string }> = [];

    // Create a test directory
    const testDirPath = `${WORKING_DIR}/milestone4-test`;
    await justBashSandbox.mkdir(testDirPath, { recursive: true });
    pendingOperations.push({
      type: "mkdir",
      path: testDirPath,
      recursive: true,
    });
    addEvent("test_dir_created");

    // Create test file 1
    const testFile1Path = `${testDirPath}/test-file-1.txt`;
    const testFile1Content = `Milestone 4 Test File 1\nCreated at: ${new Date().toISOString()}\nThis file was created in JustBash and should be replayed to Vercel.`;
    await justBashSandbox.writeFile(testFile1Path, testFile1Content, "utf-8");
    pendingOperations.push({
      type: "writeFile",
      path: testFile1Path,
      content: testFile1Content,
    });
    testFiles.push({ path: testFile1Path, content: testFile1Content });
    addEvent("test_file_1_created");

    // Create test file 2 (nested)
    const nestedDirPath = `${testDirPath}/nested`;
    await justBashSandbox.mkdir(nestedDirPath, { recursive: true });
    pendingOperations.push({
      type: "mkdir",
      path: nestedDirPath,
      recursive: true,
    });

    const testFile2Path = `${nestedDirPath}/test-file-2.json`;
    const testFile2Content = JSON.stringify(
      {
        milestone: 4,
        test: "handoff",
        timestamp: Date.now(),
        message: "This JSON file tests structured content preservation",
      },
      null,
      2,
    );
    await justBashSandbox.writeFile(testFile2Path, testFile2Content, "utf-8");
    pendingOperations.push({
      type: "writeFile",
      path: testFile2Path,
      content: testFile2Content,
    });
    testFiles.push({ path: testFile2Path, content: testFile2Content });
    addEvent("test_file_2_created");

    // Create test file 3 (modify existing file simulation)
    const testFile3Path = `${WORKING_DIR}/HANDOFF_TEST.md`;
    const testFile3Content = `# Handoff Test\n\nThis file was created during the handoff test.\n\n- Task ID: ${taskId}\n- Created: ${new Date().toISOString()}\n`;
    await justBashSandbox.writeFile(testFile3Path, testFile3Content, "utf-8");
    pendingOperations.push({
      type: "writeFile",
      path: testFile3Path,
      content: testFile3Content,
    });
    testFiles.push({ path: testFile3Path, content: testFile3Content });
    addEvent("test_file_3_created");

    // Serialize and persist JustBash state with pending operations
    const snapshot = justBashSandbox.serialize();
    await updateTask(taskId, {
      justBashSnapshot: snapshot,
      pendingOperations,
    });
    addEvent("justbash_persisted_with_pending_ops");

    // ============================================
    // PHASE 3: Start Vercel in background
    // ============================================

    const vercelStartTime = Date.now();

    await updateTask(taskId, {
      vercelStatus: "starting",
      vercelStartedAt: new Date(),
    });
    addEvent("vercel_start_marked");

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
    addEvent("vercel_ready");

    const vercelReadyMs = Date.now() - vercelStartTime;

    await updateTask(taskId, {
      vercelStatus: "ready",
      sandboxId: vercelSandbox.id,
      sandboxCreatedAt: new Date(),
      sandboxTimeout: DEFAULT_TIMEOUT,
    });
    addEvent("vercel_persisted");

    // ============================================
    // PHASE 4: Perform handoff (replay pending operations)
    // ============================================

    const handoffStartTime = Date.now();
    const handoffErrors: string[] = [];
    let operationsReplayed = 0;

    for (const op of pendingOperations) {
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
        handoffErrors.push(
          `Failed to replay ${op.type} for ${op.path}: ${message}`,
        );
      }
    }
    addEvent("operations_replayed");

    const handoffMs = Date.now() - handoffStartTime;

    // Update task to Vercel mode
    await updateTask(taskId, {
      sandboxMode: "vercel",
      justBashSnapshot: null,
      pendingOperations: null,
    });
    addEvent("handoff_complete");

    // ============================================
    // PHASE 5: Verify files in Vercel
    // ============================================

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
    addEvent("files_verified");

    const allFilesExist = filesChecked.every((f) => f.exists);
    const contentMatches = filesChecked.every((f) => f.contentMatch);

    // ============================================
    // PHASE 6: Test git works after handoff
    // ============================================

    const gitResult = await vercelSandbox.exec(
      "git status",
      vercelSandbox.workingDirectory,
      30000,
    );
    const gitWorks = gitResult.exitCode === 0;
    addEvent("git_verified");

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
        gitWorks &&
        handoffErrors.length === 0,
      taskId,
      metrics: {
        justBashReadyMs,
        vercelReadyMs,
        handoffMs,
        totalMs,
      },
      justBash: {
        fileCount: Object.keys(snapshot.files).length,
        modificationsCount: pendingOperations.length,
      },
      handoff: {
        operationsReplayed,
        errors: handoffErrors,
      },
      verification: {
        allFilesExist,
        contentMatches,
        gitWorks,
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
