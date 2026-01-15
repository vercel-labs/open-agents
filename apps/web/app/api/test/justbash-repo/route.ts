/**
 * Test endpoint for validating JustBash with GitHub repository loading.
 *
 * This validates Milestone 2 of the hybrid sandbox architecture:
 * - Load a GitHub repository via tarball into JustBash
 * - Persist full repo state across serverless request boundaries
 * - Support modifications that persist across requests
 *
 * Usage:
 *   POST /api/test/justbash-repo
 *   Body: { "action": "create", "taskId": "...", "repoUrl": "https://github.com/owner/repo", "branch": "main" }
 *   - Downloads repo tarball
 *   - Creates JustBash sandbox with extracted files
 *   - Serializes and persists to database
 *
 *   POST /api/test/justbash-repo
 *   Body: { "action": "modify", "taskId": "..." }
 *   - Restores sandbox from database
 *   - Makes test modifications
 *   - Persists updated snapshot
 *
 *   POST /api/test/justbash-repo
 *   Body: { "action": "restore", "taskId": "..." }
 *   - Restores sandbox from database
 *   - Verifies all files and modifications exist
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
import { downloadAndExtractTarball } from "@/lib/github/tarball";

const WORKING_DIR = "/vercel/sandbox";

interface RequestBody {
  action: "create" | "modify" | "restore";
  taskId: string;
  repoUrl?: string;
  branch?: string;
  token?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const { action, taskId, repoUrl, branch, token } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    switch (action) {
      case "create":
        if (!repoUrl) {
          return NextResponse.json(
            { error: "repoUrl is required for create action" },
            { status: 400 },
          );
        }
        return handleCreate(taskId, repoUrl, branch ?? "main", token);
      case "modify":
        return handleModify(taskId);
      case "restore":
        return handleRestore(taskId);
      default:
        return NextResponse.json(
          { error: 'Invalid action. Use "create", "modify", or "restore".' },
          { status: 400 },
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleCreate(
  taskId: string,
  repoUrl: string,
  branch: string,
  token?: string,
) {
  const startTime = Date.now();

  // 1. Download and extract tarball
  const tarballResult = await downloadAndExtractTarball(
    repoUrl,
    branch,
    token ?? process.env.GITHUB_TOKEN,
    WORKING_DIR,
  );

  const downloadExtractTime = Date.now() - startTime;

  // 2. Create JustBash sandbox with extracted files
  const createStart = Date.now();
  const sandbox = await createJustBashSandbox({
    workingDirectory: WORKING_DIR,
    files: tarballResult.files,
    mode: "memory",
  });
  const createMs = Date.now() - createStart;

  // 3. Serialize the sandbox state
  const serializeStart = Date.now();
  const snapshot = sandbox.serialize();
  const serializeMs = Date.now() - serializeStart;

  const snapshotJson = JSON.stringify(snapshot);
  const snapshotSizeBytes = Buffer.byteLength(snapshotJson, "utf-8");

  // 4. Persist to database
  const persistStart = Date.now();
  await db
    .update(tasks)
    .set({
      justBashSnapshot: snapshot,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  const persistMs = Date.now() - persistStart;

  // 5. Stop the sandbox
  await sandbox.stop();

  return NextResponse.json({
    success: true,
    action: "create",
    taskId,
    repoUrl,
    branch,
    timing: {
      downloadMs: Math.round(tarballResult.downloadMs),
      extractMs: Math.round(tarballResult.extractMs),
      downloadExtractMs: downloadExtractTime,
      createMs,
      serializeMs,
      persistMs,
      totalMs: Date.now() - startTime,
    },
    tarball: {
      fileCount: tarballResult.fileCount,
      totalBytes: tarballResult.totalBytes,
    },
    snapshot: {
      fileCount: Object.keys(snapshot.files).length,
      sizeBytes: snapshotSizeBytes,
      workingDirectory: snapshot.workingDirectory,
    },
  });
}

async function handleModify(taskId: string) {
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
      { error: "No JustBash snapshot found. Run create action first." },
      { status: 404 },
    );
  }

  const loadMs = Date.now() - startTime;

  // 2. Restore sandbox from snapshot
  const restoreStart = Date.now();
  const snapshot = task.justBashSnapshot as JustBashSnapshot;
  const sandbox = await JustBashSandbox.fromSnapshot(snapshot);
  const restoreMs = Date.now() - restoreStart;

  // 3. Make test modifications
  const modifyStart = Date.now();

  // Create a new file
  await sandbox.writeFile(
    `${WORKING_DIR}/AGENT_NOTES.md`,
    `# Agent Notes\n\nCreated at: ${new Date().toISOString()}\n\nThis file was created by the agent during the modify phase.\n`,
    "utf-8",
  );

  // Create a new directory and file
  await sandbox.mkdir(`${WORKING_DIR}/.agent`, { recursive: true });
  await sandbox.writeFile(
    `${WORKING_DIR}/.agent/state.json`,
    JSON.stringify({ modified: true, timestamp: Date.now() }, null, 2),
    "utf-8",
  );

  // Modify an existing file if package.json exists
  try {
    const packageJsonPath = `${WORKING_DIR}/package.json`;
    const existingContent = await sandbox.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(existingContent);
    pkg._agentModified = true;
    pkg._agentModifiedAt = new Date().toISOString();
    await sandbox.writeFile(
      packageJsonPath,
      JSON.stringify(pkg, null, 2),
      "utf-8",
    );
  } catch {
    // package.json doesn't exist, skip modification
  }

  const modifyMs = Date.now() - modifyStart;

  // 4. Serialize updated state
  const serializeStart = Date.now();
  const updatedSnapshot = sandbox.serialize();
  const serializeMs = Date.now() - serializeStart;

  const snapshotJson = JSON.stringify(updatedSnapshot);
  const snapshotSizeBytes = Buffer.byteLength(snapshotJson, "utf-8");

  // 5. Persist to database
  const persistStart = Date.now();
  await db
    .update(tasks)
    .set({
      justBashSnapshot: updatedSnapshot,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  const persistMs = Date.now() - persistStart;

  // 6. Stop the sandbox
  await sandbox.stop();

  return NextResponse.json({
    success: true,
    action: "modify",
    taskId,
    timing: {
      loadMs,
      restoreMs,
      modifyMs,
      serializeMs,
      persistMs,
      totalMs: Date.now() - startTime,
    },
    modifications: [
      `${WORKING_DIR}/AGENT_NOTES.md`,
      `${WORKING_DIR}/.agent/state.json`,
      `${WORKING_DIR}/package.json (if exists)`,
    ],
    snapshot: {
      fileCount: Object.keys(updatedSnapshot.files).length,
      sizeBytes: snapshotSizeBytes,
      workingDirectory: updatedSnapshot.workingDirectory,
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
      { error: "No JustBash snapshot found. Run create action first." },
      { status: 404 },
    );
  }

  const loadMs = Date.now() - startTime;

  // 2. Restore sandbox from snapshot
  const restoreStart = Date.now();
  const snapshot = task.justBashSnapshot as JustBashSnapshot;
  const sandbox = await JustBashSandbox.fromSnapshot(snapshot);
  const restoreMs = Date.now() - restoreStart;

  // 3. Verify files exist
  const verifyStart = Date.now();
  const verificationResults: Record<
    string,
    {
      exists: boolean;
      contentPreview?: string;
      size?: number;
      isDirectory?: boolean;
    }
  > = {};

  // Check key files
  const filesToCheck = [
    `${WORKING_DIR}/package.json`,
    `${WORKING_DIR}/README.md`,
    `${WORKING_DIR}/AGENT_NOTES.md`,
    `${WORKING_DIR}/.agent/state.json`,
  ];

  for (const filePath of filesToCheck) {
    try {
      const content = await sandbox.readFile(filePath, "utf-8");
      verificationResults[filePath] = {
        exists: true,
        contentPreview:
          content.length > 100 ? `${content.slice(0, 100)}...` : content,
        size: content.length,
      };
    } catch {
      verificationResults[filePath] = { exists: false };
    }
  }

  // Check directories
  const dirsToCheck = [`${WORKING_DIR}`, `${WORKING_DIR}/.agent`];

  for (const dirPath of dirsToCheck) {
    try {
      const stats = await sandbox.stat(dirPath);
      if (stats.isDirectory()) {
        const entries = await sandbox.readdir(dirPath, { withFileTypes: true });
        verificationResults[dirPath] = {
          exists: true,
          isDirectory: true,
          size: entries.length,
        };
      }
    } catch {
      verificationResults[dirPath] = { exists: false };
    }
  }

  const verifyMs = Date.now() - verifyStart;

  // 4. Stop the sandbox
  await sandbox.stop();

  // Count successes
  const existingFiles = Object.values(verificationResults).filter(
    (r) => r.exists,
  ).length;
  const totalChecked = Object.keys(verificationResults).length;

  return NextResponse.json({
    success: true,
    action: "restore",
    taskId,
    timing: {
      loadMs,
      restoreMs,
      verifyMs,
      totalMs: Date.now() - startTime,
    },
    verification: {
      existingFiles,
      totalChecked,
      details: verificationResults,
    },
    snapshot: {
      fileCount: Object.keys(snapshot.files).length,
      workingDirectory: snapshot.workingDirectory,
    },
  });
}
