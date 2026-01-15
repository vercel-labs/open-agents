/**
 * Test script for Milestone 3: Background Vercel Startup
 *
 * Validates that:
 * 1. JustBash is ready immediately (~100-500ms)
 * 2. Vercel starts in background
 * 3. Agent can work on JustBash during Vercel startup
 * 4. Both sandboxes are operational
 *
 * Usage: bun run apps/web/scripts/test-milestone3.ts
 */

const TEST_REPO_URL = "https://github.com/vercel-labs/ai-sdk-preview-rag";
const TEST_BRANCH = "main";

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

async function runTest(): Promise<TestResult> {
  const response = await fetch(
    "http://localhost:3000/api/test/hybrid-background",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: TEST_REPO_URL,
        branch: TEST_BRANCH,
        cleanup: true,
      }),
    },
  );

  const text = await response.text();
  let result: TestResult | { success: false; error: string };
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Failed to parse response (status ${response.status}): ${text}`,
    );
  }

  if (!response.ok || !result.success) {
    throw new Error(
      `Test failed (status ${response.status}): ${JSON.stringify(result)}`,
    );
  }

  return result as TestResult;
}

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║         Milestone 3: Background Vercel Startup - Test              ║
╠════════════════════════════════════════════════════════════════════╣
║  Repository: ${TEST_REPO_URL.padEnd(50)} ║
║  Branch:     ${TEST_BRANCH.padEnd(50)} ║
╚════════════════════════════════════════════════════════════════════╝
`);

  try {
    console.log("Running test...\n");
    const result = await runTest();

    console.log("═".repeat(70));
    console.log("TIMELINE");
    console.log("═".repeat(70));
    console.log("");
    for (const event of result.timeline) {
      const bar = "█".repeat(Math.min(Math.ceil(event.ms / 200), 40));
      console.log(`  ${formatMs(event.ms).padStart(8)} │ ${event.event}`);
      if (event.ms > 100) {
        console.log(`           │ ${bar}`);
      }
    }

    console.log("\n" + "═".repeat(70));
    console.log("JUSTBASH (Instant Start)");
    console.log("═".repeat(70));
    console.log(`
  Ready in:       ${formatMs(result.metrics.justBashReadyMs)}
  File count:     ${result.justBash.fileCount} files
  Snapshot size:  ${(result.justBash.snapshotSizeBytes / 1024).toFixed(1)} KB
  Can read:       ${result.justBash.canRead ? "✅ Yes" : "❌ No"}
  Can write:      ${result.justBash.canWrite ? "✅ Yes" : "❌ No"}
`);

    console.log("═".repeat(70));
    console.log("VERCEL (Background Startup)");
    console.log("═".repeat(70));
    console.log(`
  Startup time:   ${formatMs(result.metrics.vercelReadyMs)}
  Sandbox ID:     ${result.vercel.sandboxId}
  Can read:       ${result.vercel.canRead ? "✅ Yes" : "❌ No"}
  Can exec git:   ${result.vercel.canExecGit ? "✅ Yes" : "❌ No"}
`);

    console.log("═".repeat(70));
    console.log("METRICS COMPARISON");
    console.log("═".repeat(70));
    console.log(`
  Time to first interaction:  ${formatMs(result.metrics.timeToFirstInteraction)}
  Vercel startup time:        ${formatMs(result.metrics.vercelReadyMs)}
  Time saved:                 ${formatMs(result.metrics.timeSavedMs)}
  Speedup:                    ${(result.metrics.vercelReadyMs / result.metrics.justBashReadyMs).toFixed(1)}x faster

  Without hybrid:  User waits ${formatMs(result.metrics.vercelReadyMs)} before agent starts
  With hybrid:     User waits ${formatMs(result.metrics.justBashReadyMs)} before agent starts
`);

    // Check success criteria
    console.log("═".repeat(70));
    console.log("SUCCESS CRITERIA");
    console.log("═".repeat(70));

    const criteria = [
      {
        name: "Agent activity within 500ms",
        pass: result.metrics.justBashReadyMs < 500,
        value: `${result.metrics.justBashReadyMs}ms`,
      },
      {
        name: "Vercel ready within 15s",
        pass: result.metrics.vercelReadyMs < 15000,
        value: formatMs(result.metrics.vercelReadyMs),
      },
      {
        name: "JustBash can read files",
        pass: result.justBash.canRead,
        value: result.justBash.canRead ? "Yes" : "No",
      },
      {
        name: "JustBash can write files",
        pass: result.justBash.canWrite,
        value: result.justBash.canWrite ? "Yes" : "No",
      },
      {
        name: "Vercel can read files",
        pass: result.vercel.canRead,
        value: result.vercel.canRead ? "Yes" : "No",
      },
      {
        name: "Vercel can exec git",
        pass: result.vercel.canExecGit,
        value: result.vercel.canExecGit ? "Yes" : "No",
      },
    ];

    console.log("");
    for (const c of criteria) {
      const icon = c.pass ? "✅" : "❌";
      console.log(`  ${icon} ${c.name.padEnd(35)} ${c.value}`);
    }
    console.log("");

    const allPass = criteria.every((c) => c.pass);

    if (allPass) {
      console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║    🎉 Milestone 3: Background Vercel Startup - VALIDATED! 🎉      ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);
    } else {
      console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║    ⚠️  Milestone 3: Some criteria not met                         ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exitCode = 1;
  }
}

main();
