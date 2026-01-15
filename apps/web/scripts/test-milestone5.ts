/**
 * Test script for Milestone 5: Chat Route Integration
 *
 * Validates that:
 * 1. User can interact within ~1s (JustBash starts fast)
 * 2. Agent can read/write files immediately
 * 3. Pending operations persist across requests
 * 4. Auto-handoff occurs when Vercel is ready
 * 5. All file changes persist after handoff
 * 6. Git/npm commands work after handoff
 *
 * Usage: bun run apps/web/scripts/test-milestone5.ts
 */

const M5_TEST_REPO_URL = "https://github.com/vercel-labs/ai-sdk-preview-rag";
const M5_TEST_BRANCH = "main";

interface M5TestResult {
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

async function runM5Test(): Promise<M5TestResult> {
  const response = await fetch("http://localhost:3000/api/test/hybrid-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: M5_TEST_REPO_URL,
      branch: M5_TEST_BRANCH,
      cleanup: true,
    }),
  });

  const text = await response.text();
  let result: M5TestResult | { success: false; error: string };
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

  return result as M5TestResult;
}

function formatM5Ms(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

async function m5Main() {
  console.log(`
${"=".repeat(70)}
         Milestone 5: Chat Route Integration - Test
${"=".repeat(70)}
  Repository: ${M5_TEST_REPO_URL}
  Branch:     ${M5_TEST_BRANCH}
${"=".repeat(70)}
`);

  try {
    console.log("Running test...\n");
    const result = await runM5Test();

    console.log("=".repeat(70));
    console.log("TIMELINE");
    console.log("=".repeat(70));
    console.log("");
    for (const event of result.timeline) {
      const bar = "=".repeat(Math.min(Math.ceil(event.ms / 200), 40));
      console.log(`  ${formatM5Ms(event.ms).padStart(8)} | ${event.event}`);
      if (event.ms > 100) {
        console.log(`           | ${bar}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("TURN 1: Initial Request (JustBash)");
    console.log("=".repeat(70));
    console.log(`
  Duration:           ${formatM5Ms(result.metrics.turn1Ms)}
  Sandbox mode:       ${result.turns.turn1.sandboxMode}
  Files read:         ${result.turns.turn1.filesRead}
  Files written:      ${result.turns.turn1.filesWritten}
  Pending ops:        ${result.turns.turn1.pendingOpsCount}
`);

    console.log("=".repeat(70));
    console.log("TURN 2: Second Request (JustBash, more writes)");
    console.log("=".repeat(70));
    console.log(`
  Duration:           ${formatM5Ms(result.metrics.turn2Ms)}
  Sandbox mode:       ${result.turns.turn2.sandboxMode}
  Restored ops:       ${result.turns.turn2.pendingOpsRestored}
  Files written:      ${result.turns.turn2.filesWritten}
  Total pending ops:  ${result.turns.turn2.totalPendingOps}
`);

    console.log("=".repeat(70));
    console.log("TURN 3: Third Request (Handoff + Vercel)");
    console.log("=".repeat(70));
    console.log(`
  Duration:           ${formatM5Ms(result.metrics.turn3Ms)}
  Sandbox mode:       ${result.turns.turn3.sandboxMode}
  Handoff occurred:   ${result.turns.turn3.handoffOccurred ? "Yes" : "No"}
  Handoff time:       ${formatM5Ms(result.metrics.handoffMs)}
  Git works:          ${result.turns.turn3.gitWorks ? "Yes" : "No"}
`);

    console.log("=".repeat(70));
    console.log("FILE VERIFICATION (Post-Handoff)");
    console.log("=".repeat(70));
    console.log("");
    for (const file of result.verification.filesChecked) {
      const existsIcon = file.exists ? "[OK]" : "[FAIL]";
      const matchIcon = file.contentMatch ? "[OK]" : "[FAIL]";
      const shortPath = file.path.replace("/vercel/sandbox/", "./");
      console.log(`  ${existsIcon} Exists: ${shortPath}`);
      console.log(`  ${matchIcon} Content matches`);
      console.log("");
    }

    // Check success criteria
    console.log("=".repeat(70));
    console.log("SUCCESS CRITERIA");
    console.log("=".repeat(70));

    const criteria = [
      {
        name: "User interaction within 1s",
        pass: result.metrics.justBashReadyMs < 1000,
        value: formatM5Ms(result.metrics.justBashReadyMs),
      },
      {
        name: "Agent writes tracked as pending ops",
        pass: result.turns.turn1.pendingOpsCount > 0,
        value: `${result.turns.turn1.pendingOpsCount} ops`,
      },
      {
        name: "Pending ops persist across requests",
        pass: result.turns.turn2.pendingOpsRestored > 0,
        value: `${result.turns.turn2.pendingOpsRestored} restored`,
      },
      {
        name: "Pending ops accumulate correctly",
        pass:
          result.turns.turn2.totalPendingOps >
          result.turns.turn2.pendingOpsRestored,
        value: `${result.turns.turn2.totalPendingOps} total`,
      },
      {
        name: "Auto-handoff when Vercel ready",
        pass: result.turns.turn3.handoffOccurred,
        value: result.turns.turn3.handoffOccurred ? "Yes" : "No",
      },
      {
        name: "All files exist after handoff",
        pass: result.verification.allFilesExist,
        value: result.verification.allFilesExist ? "Yes" : "No",
      },
      {
        name: "File content matches after handoff",
        pass: result.verification.contentMatches,
        value: result.verification.contentMatches ? "Yes" : "No",
      },
      {
        name: "Git works after handoff",
        pass: result.turns.turn3.gitWorks,
        value: result.turns.turn3.gitWorks ? "Yes" : "No",
      },
    ];

    console.log("");
    for (const c of criteria) {
      const icon = c.pass ? "[OK]" : "[FAIL]";
      console.log(`  ${icon} ${c.name.padEnd(40)} ${c.value}`);
    }
    console.log("");

    // Summary metrics
    console.log("=".repeat(70));
    console.log("SUMMARY METRICS");
    console.log("=".repeat(70));
    console.log(`
  | Metric               | Value                |
  |----------------------|----------------------|
  | JustBash init        | ${formatM5Ms(result.metrics.justBashReadyMs).padEnd(20)} |
  | Turn 1 (read/write)  | ${formatM5Ms(result.metrics.turn1Ms).padEnd(20)} |
  | Turn 2 (more writes) | ${formatM5Ms(result.metrics.turn2Ms).padEnd(20)} |
  | Vercel startup       | ${formatM5Ms(result.metrics.vercelReadyMs).padEnd(20)} |
  | Handoff time         | ${formatM5Ms(result.metrics.handoffMs).padEnd(20)} |
  | Turn 3 (after hand)  | ${formatM5Ms(result.metrics.turn3Ms).padEnd(20)} |
  | Total time           | ${formatM5Ms(result.metrics.totalMs).padEnd(20)} |
`);

    const allPass = criteria.every((c) => c.pass);

    if (allPass) {
      console.log(`
${"=".repeat(70)}

    Milestone 5: Chat Route Integration - VALIDATED!

${"=".repeat(70)}
`);
    } else {
      console.log(`
${"=".repeat(70)}

    Milestone 5: Some criteria not met

${"=".repeat(70)}
`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n[FAIL] Test failed:", error);
    process.exitCode = 1;
  }
}

m5Main();
