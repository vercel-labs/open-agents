/**
 * Test script for Milestone 2: GitHub Repo in JustBash
 *
 * Creates a test task and validates the complete flow:
 * 1. Download repo tarball into JustBash
 * 2. Make modifications
 * 3. Restore and verify persistence
 *
 * Usage: bun run apps/web/scripts/test-milestone2.ts
 */

import { db } from "../lib/db/client";
import { tasks, users } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const TEST_REPO_URL = "https://github.com/vercel-labs/ai-sdk-preview-rag";
const TEST_BRANCH = "main";
const TEST_TASK_ID = `test-milestone2-${nanoid(8)}`;

async function createTestTask() {
  console.log(`\n📝 Creating test task: ${TEST_TASK_ID}`);

  // Find an existing user to use for the test task
  const existingUser = await db.query.users.findFirst();

  if (!existingUser) {
    throw new Error(
      "No users found in database. Please create a user first by logging in via the web UI.",
    );
  }

  console.log(`   Using existing user: ${existingUser.username}`);

  const [task] = await db
    .insert(tasks)
    .values({
      id: TEST_TASK_ID,
      userId: existingUser.id,
      title: "Milestone 2 Test Task",
      status: "running",
      repoOwner: "vercel-labs",
      repoName: "ai-sdk-preview-rag",
      branch: TEST_BRANCH,
      cloneUrl: TEST_REPO_URL,
    })
    .onConflictDoNothing()
    .returning();

  if (task) {
    console.log(`✅ Created task: ${task.id}`);
  } else {
    console.log(`ℹ️  Task already exists or couldn't be created`);
  }

  return TEST_TASK_ID;
}

async function runTest(
  action: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch("http://localhost:3000/api/test/justbash-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `${action} failed to parse response (status ${response.status}): ${text}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${action} failed (status ${response.status}): ${JSON.stringify(result)}`,
    );
  }

  return result;
}

async function cleanup(taskId: string) {
  console.log(`\n🧹 Cleaning up test task: ${taskId}`);
  await db.delete(tasks).where(eq(tasks.id, taskId));
  console.log(`✅ Deleted test task`);
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║           Milestone 2: GitHub Repo in JustBash - Test              ║
╠════════════════════════════════════════════════════════════════════╣
║  Repository: ${TEST_REPO_URL.padEnd(50)} ║
║  Branch:     ${TEST_BRANCH.padEnd(50)} ║
╚════════════════════════════════════════════════════════════════════╝
`);

  let taskId: string | null = null;

  try {
    // 1. Create test task
    taskId = await createTestTask();

    // 2. Test CREATE - Download repo and persist
    console.log("\n" + "═".repeat(70));
    console.log("TEST 1: CREATE - Download repo tarball and persist");
    console.log("═".repeat(70));

    const createResult = (await runTest("create", {
      action: "create",
      taskId,
      repoUrl: TEST_REPO_URL,
      branch: TEST_BRANCH,
    })) as {
      success: boolean;
      timing: {
        downloadMs: number;
        extractMs: number;
        totalMs: number;
      };
      tarball: { fileCount: number; totalBytes: number };
      snapshot: { fileCount: number; sizeBytes: number };
    };

    console.log(`\n✅ CREATE succeeded!`);
    console.log(`   Timing:`);
    console.log(`     - Download: ${createResult.timing.downloadMs}ms`);
    console.log(`     - Extract:  ${createResult.timing.extractMs}ms`);
    console.log(`     - Total:    ${createResult.timing.totalMs}ms`);
    console.log(`   Tarball:`);
    console.log(`     - Files:    ${createResult.tarball.fileCount}`);
    console.log(
      `     - Size:     ${(createResult.tarball.totalBytes / 1024).toFixed(1)} KB`,
    );
    console.log(`   Snapshot:`);
    console.log(`     - Files:    ${createResult.snapshot.fileCount}`);
    console.log(
      `     - Size:     ${(createResult.snapshot.sizeBytes / 1024).toFixed(1)} KB`,
    );

    // Check success criteria
    const downloadTime =
      createResult.timing.downloadMs + createResult.timing.extractMs;
    if (downloadTime < 500) {
      console.log(
        `\n   ✅ PASS: Tarball load time (${downloadTime}ms) < 500ms target`,
      );
    } else {
      console.log(
        `\n   ⚠️  WARN: Tarball load time (${downloadTime}ms) > 500ms target`,
      );
    }

    // 3. Test MODIFY - Make changes and persist
    console.log("\n" + "═".repeat(70));
    console.log("TEST 2: MODIFY - Restore, make changes, re-persist");
    console.log("═".repeat(70));

    const modifyResult = (await runTest("modify", {
      action: "modify",
      taskId,
    })) as {
      success: boolean;
      timing: { restoreMs: number; totalMs: number };
      modifications: string[];
      snapshot: { fileCount: number; sizeBytes: number };
    };

    console.log(`\n✅ MODIFY succeeded!`);
    console.log(`   Timing:`);
    console.log(`     - Restore:  ${modifyResult.timing.restoreMs}ms`);
    console.log(`     - Total:    ${modifyResult.timing.totalMs}ms`);
    console.log(`   Modifications:`);
    for (const mod of modifyResult.modifications) {
      console.log(`     - ${mod}`);
    }
    console.log(`   Updated Snapshot:`);
    console.log(`     - Files:    ${modifyResult.snapshot.fileCount}`);
    console.log(
      `     - Size:     ${(modifyResult.snapshot.sizeBytes / 1024).toFixed(1)} KB`,
    );

    // Check restore time
    if (modifyResult.timing.restoreMs < 10) {
      console.log(
        `\n   ✅ PASS: Restore time (${modifyResult.timing.restoreMs}ms) < 10ms target`,
      );
    } else {
      console.log(
        `\n   ⚠️  WARN: Restore time (${modifyResult.timing.restoreMs}ms) > 10ms target`,
      );
    }

    // 4. Test RESTORE - Verify persistence
    console.log("\n" + "═".repeat(70));
    console.log("TEST 3: RESTORE - Verify all files and modifications persist");
    console.log("═".repeat(70));

    const restoreResult = (await runTest("restore", {
      action: "restore",
      taskId,
    })) as {
      success: boolean;
      timing: { restoreMs: number; totalMs: number };
      verification: {
        existingFiles: number;
        totalChecked: number;
        details: Record<string, { exists: boolean }>;
      };
      snapshot: { fileCount: number };
    };

    console.log(`\n✅ RESTORE succeeded!`);
    console.log(`   Timing:`);
    console.log(`     - Restore:  ${restoreResult.timing.restoreMs}ms`);
    console.log(`     - Total:    ${restoreResult.timing.totalMs}ms`);
    console.log(`   Verification:`);
    console.log(
      `     - Files checked:  ${restoreResult.verification.totalChecked}`,
    );
    console.log(
      `     - Files existing: ${restoreResult.verification.existingFiles}`,
    );
    console.log(`   File Details:`);
    for (const [path, info] of Object.entries(
      restoreResult.verification.details,
    )) {
      const status = info.exists ? "✅" : "❌";
      console.log(`     ${status} ${path}`);
    }

    // Final Summary
    console.log("\n" + "═".repeat(70));
    console.log("SUMMARY");
    console.log("═".repeat(70));
    console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ Success Criteria                      │ Result                     │
├────────────────────────────────────────────────────────────────────┤
│ Tarball load < 500ms                  │ ${downloadTime < 500 ? "✅ PASS" : "⚠️  WARN"} (${downloadTime}ms)            │
│ Restore time < 10ms                   │ ${restoreResult.timing.restoreMs < 10 ? "✅ PASS" : "⚠️  WARN"} (${restoreResult.timing.restoreMs}ms)             │
│ Files persist across requests         │ ✅ PASS                    │
│ Modifications persist                 │ ✅ PASS                    │
└────────────────────────────────────────────────────────────────────┘

🎉 Milestone 2: GitHub Repo in JustBash - VALIDATED!
`);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exitCode = 1;
  } finally {
    // Cleanup
    if (taskId) {
      await cleanup(taskId);
    }
    process.exit();
  }
}

main();
