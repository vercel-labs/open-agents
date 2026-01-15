/**
 * Test endpoint for validating JustBash persistence across serverless requests.
 *
 * This validates Milestone 1 of the hybrid sandbox architecture:
 * - Turn 1: Create sandbox, make modifications, serialize to DB
 * - Turn 2: Restore from DB, verify files exist with correct content
 *
 * Usage:
 *   POST /api/test/justbash-persistence
 *   Body: { "action": "create", "taskId": "test-task-123" }
 *   - Creates a JustBash sandbox
 *   - Makes modifications (creates files/directories)
 *   - Serializes state to database
 *
 *   POST /api/test/justbash-persistence
 *   Body: { "action": "restore", "taskId": "test-task-123" }
 *   - Restores sandbox from database snapshot
 *   - Verifies all files exist with correct content
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import {
  createJustBashSandbox,
  JustBashSandbox,
  type JustBashSnapshot,
} from "@open-harness/sandbox";

const WORKING_DIR = "/workspace";

// Test files to create and verify
const TEST_FILES = {
  [`${WORKING_DIR}/hello.txt`]: "Hello from JustBash!",
  [`${WORKING_DIR}/config/settings.json`]: JSON.stringify(
    { theme: "dark", version: 1 },
    null,
    2,
  ),
  [`${WORKING_DIR}/src/index.ts`]: 'console.log("Hello, world!");',
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, taskId } = body as { action: string; taskId: string };

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    if (action === "create") {
      return handleCreate(taskId);
    } else if (action === "restore") {
      return handleRestore(taskId);
    } else if (action === "debug") {
      return handleDebug();
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "create", "restore", or "debug".' },
        { status: 400 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleCreate(taskId: string) {
  const startTime = Date.now();

  // 1. Create a JustBash sandbox
  const sandbox = await createJustBashSandbox({
    workingDirectory: WORKING_DIR,
    files: {
      // Start with an empty working directory
      [`${WORKING_DIR}/.keep`]: "",
    },
    mode: "memory",
  });

  const createTime = Date.now() - startTime;

  // 2. Make modifications (simulating agent activity)
  for (const [path, content] of Object.entries(TEST_FILES)) {
    await sandbox.writeFile(path, content, "utf-8");
  }

  // Also test mkdir
  await sandbox.mkdir(`${WORKING_DIR}/data`, { recursive: true });

  const modifyTime = Date.now() - startTime - createTime;

  // 3. Serialize the sandbox state
  const snapshot = sandbox.serialize();
  const serializeTime = Date.now() - startTime - createTime - modifyTime;

  // 4. Persist to database
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotSizeBytes = Buffer.byteLength(snapshotJson, "utf-8");

  await db
    .update(tasks)
    .set({
      justBashSnapshot: snapshot,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  const persistTime =
    Date.now() - startTime - createTime - modifyTime - serializeTime;

  // 5. Stop the sandbox (cleanup)
  await sandbox.stop();

  return NextResponse.json({
    success: true,
    action: "create",
    taskId,
    timing: {
      createMs: createTime,
      modifyMs: modifyTime,
      serializeMs: serializeTime,
      persistMs: persistTime,
      totalMs: Date.now() - startTime,
    },
    snapshot: {
      fileCount: Object.keys(snapshot.files).length,
      sizeBytes: snapshotSizeBytes,
      workingDirectory: snapshot.workingDirectory,
    },
  });
}

async function handleDebug() {
  // Debug: test write -> read -> serialize -> deserialize without DB
  const testContent = JSON.stringify({ theme: "dark", version: 1 }, null, 2);

  // Step 1: Create sandbox and write
  const sandbox = await createJustBashSandbox({
    workingDirectory: WORKING_DIR,
    files: { [`${WORKING_DIR}/.keep`]: "" },
    mode: "memory",
  });

  await sandbox.writeFile(`${WORKING_DIR}/test.json`, testContent, "utf-8");

  // Step 2: Read immediately (test writeFile)
  const afterWrite = await sandbox.readFile(
    `${WORKING_DIR}/test.json`,
    "utf-8",
  );

  // Step 3: Serialize
  const snapshot = sandbox.serialize();
  const snapshotContent = snapshot.files[`${WORKING_DIR}/test.json`]?.content;

  // Step 4: Restore from snapshot
  const restored = await JustBashSandbox.fromSnapshot(snapshot);
  const afterRestore = await restored.readFile(
    `${WORKING_DIR}/test.json`,
    "utf-8",
  );

  await sandbox.stop();
  await restored.stop();

  return NextResponse.json({
    original: testContent,
    afterWrite,
    snapshotContent,
    afterRestore,
    matches: {
      writeCorrect: afterWrite === testContent,
      serializeCorrect: snapshotContent === testContent,
      restoreCorrect: afterRestore === testContent,
    },
  });
}

async function handleRestore(taskId: string) {
  const startTime = Date.now();

  // 1. Load snapshot from database
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { justBashSnapshot: true },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.justBashSnapshot) {
    return NextResponse.json(
      { error: "No JustBash snapshot found for this task" },
      { status: 404 },
    );
  }

  const loadTime = Date.now() - startTime;

  // 2. Restore sandbox from snapshot
  const snapshot = task.justBashSnapshot as JustBashSnapshot;
  const sandbox = await JustBashSandbox.fromSnapshot(snapshot);

  const restoreTime = Date.now() - startTime - loadTime;

  // 3. Verify all files exist with correct content
  const verificationResults: Record<
    string,
    { exists: boolean; contentMatch: boolean; content?: string }
  > = {};

  for (const [path, expectedContent] of Object.entries(TEST_FILES)) {
    try {
      const actualContent = await sandbox.readFile(path, "utf-8");
      verificationResults[path] = {
        exists: true,
        contentMatch: actualContent === expectedContent,
        content:
          actualContent.length > 100
            ? `${actualContent.slice(0, 100)}...`
            : actualContent,
      };
    } catch {
      verificationResults[path] = {
        exists: false,
        contentMatch: false,
      };
    }
  }

  // Check the directory we created
  try {
    const stats = await sandbox.stat(`${WORKING_DIR}/data`);
    verificationResults[`${WORKING_DIR}/data`] = {
      exists: true,
      contentMatch: stats.isDirectory(),
    };
  } catch {
    verificationResults[`${WORKING_DIR}/data`] = {
      exists: false,
      contentMatch: false,
    };
  }

  const verifyTime = Date.now() - startTime - loadTime - restoreTime;

  // 4. Check if all verifications passed
  const allPassed = Object.values(verificationResults).every(
    (r) => r.exists && r.contentMatch,
  );

  // 5. Stop the sandbox
  await sandbox.stop();

  return NextResponse.json({
    success: allPassed,
    action: "restore",
    taskId,
    timing: {
      loadMs: loadTime,
      restoreMs: restoreTime,
      verifyMs: verifyTime,
      totalMs: Date.now() - startTime,
    },
    verification: verificationResults,
    snapshot: {
      fileCount: Object.keys(snapshot.files).length,
      workingDirectory: snapshot.workingDirectory,
    },
  });
}
