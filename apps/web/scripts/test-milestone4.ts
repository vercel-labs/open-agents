/**
 * Test script for Milestone 4: Seamless Handoff
 *
 * Validates that:
 * 1. JustBash can track pending write operations
 * 2. Writes made on JustBash are replayed to Vercel during handoff
 * 3. All files exist in Vercel with correct content after handoff
 * 4. Git/npm commands work after handoff
 *
 * Usage: bun run apps/web/scripts/test-milestone4.ts
 */

const M4_TEST_REPO_URL = "https://github.com/vercel-labs/ai-sdk-preview-rag";
const M4_TEST_BRANCH = "main";

interface M4TestResult {
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

async function runM4Test(): Promise<M4TestResult> {
  const response = await fetch(
    "http://localhost:3000/api/test/hybrid-handoff",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl: M4_TEST_REPO_URL,
        branch: M4_TEST_BRANCH,
        cleanup: true,
      }),
    },
  );

  const text = await response.text();
  let result: M4TestResult | { success: false; error: string };
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

  return result as M4TestResult;
}

function formatM4Ms(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

async function m4Main() {
  console.log(`
${"=".repeat(70)}
         Milestone 4: Seamless Handoff - Test
${"=".repeat(70)}
  Repository: ${M4_TEST_REPO_URL}
  Branch:     ${M4_TEST_BRANCH}
${"=".repeat(70)}
`);

  try {
    console.log("Running test...\n");
    const result = await runM4Test();

    console.log("=".repeat(70));
    console.log("TIMELINE");
    console.log("=".repeat(70));
    console.log("");
    for (const event of result.timeline) {
      const bar = "=".repeat(Math.min(Math.ceil(event.ms / 200), 40));
      console.log(`  ${formatM4Ms(event.ms).padStart(8)} | ${event.event}`);
      if (event.ms > 100) {
        console.log(`           | ${bar}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("JUSTBASH (Pre-Handoff)");
    console.log("=".repeat(70));
    console.log(`
  Ready in:           ${formatM4Ms(result.metrics.justBashReadyMs)}
  File count:         ${result.justBash.fileCount} files
  Modifications:      ${result.justBash.modificationsCount} pending operations
`);

    console.log("=".repeat(70));
    console.log("VERCEL (Background Startup)");
    console.log("=".repeat(70));
    console.log(`
  Startup time:       ${formatM4Ms(result.metrics.vercelReadyMs)}
`);

    console.log("=".repeat(70));
    console.log("HANDOFF");
    console.log("=".repeat(70));
    console.log(`
  Handoff time:       ${formatM4Ms(result.metrics.handoffMs)}
  Operations replayed: ${result.handoff.operationsReplayed}
  Errors:             ${result.handoff.errors.length === 0 ? "None" : result.handoff.errors.join(", ")}
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

    console.log("=".repeat(70));
    console.log("GIT VERIFICATION (Post-Handoff)");
    console.log("=".repeat(70));
    console.log(`
  Git works:          ${result.verification.gitWorks ? "[OK] Yes" : "[FAIL] No"}
`);

    // Check success criteria
    console.log("=".repeat(70));
    console.log("SUCCESS CRITERIA");
    console.log("=".repeat(70));

    const criteria = [
      {
        name: "All writes replay correctly",
        pass: result.handoff.errors.length === 0,
        value:
          result.handoff.errors.length === 0
            ? `${result.handoff.operationsReplayed} ops`
            : `${result.handoff.errors.length} errors`,
      },
      {
        name: "All files exist in Vercel",
        pass: result.verification.allFilesExist,
        value: result.verification.allFilesExist ? "Yes" : "No",
      },
      {
        name: "File content matches exactly",
        pass: result.verification.contentMatches,
        value: result.verification.contentMatches ? "Yes" : "No",
      },
      {
        name: "Git works after handoff",
        pass: result.verification.gitWorks,
        value: result.verification.gitWorks ? "Yes" : "No",
      },
      {
        name: "Handoff time < 5s",
        pass: result.metrics.handoffMs < 5000,
        value: formatM4Ms(result.metrics.handoffMs),
      },
    ];

    console.log("");
    for (const c of criteria) {
      const icon = c.pass ? "[OK]" : "[FAIL]";
      console.log(`  ${icon} ${c.name.padEnd(35)} ${c.value}`);
    }
    console.log("");

    // Summary metrics
    console.log("=".repeat(70));
    console.log("SUMMARY METRICS");
    console.log("=".repeat(70));
    console.log(`
  | Metric               | Value                |
  |----------------------|----------------------|
  | JustBash ready       | ${formatM4Ms(result.metrics.justBashReadyMs).padEnd(20)} |
  | Vercel ready         | ${formatM4Ms(result.metrics.vercelReadyMs).padEnd(20)} |
  | Handoff time         | ${formatM4Ms(result.metrics.handoffMs).padEnd(20)} |
  | Total time           | ${formatM4Ms(result.metrics.totalMs).padEnd(20)} |
`);

    const allPass = criteria.every((c) => c.pass);

    if (allPass) {
      console.log(`
${"=".repeat(70)}

    Milestone 4: Seamless Handoff - VALIDATED!

${"=".repeat(70)}
`);
    } else {
      console.log(`
${"=".repeat(70)}

    Milestone 4: Some criteria not met

${"=".repeat(70)}
`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n[FAIL] Test failed:", error);
    process.exitCode = 1;
  }
}

m4Main();
