/**
 * Hybrid Sandbox Test
 *
 * This script tests the hypothesis that we can eliminate perceived startup
 * latency by using an in-memory JustBash sandbox while Vercel spins up.
 *
 * Usage:
 *   bun run apps/cli/hybrid-sandbox-test.ts <github-repo-url> [branch]
 *
 * Example:
 *   bun run apps/cli/hybrid-sandbox-test.ts https://github.com/vercel/ai main
 */

import { gunzipSync } from "zlib";
import {
  createJustBashSandbox,
  connectVercelSandbox,
  type Sandbox,
} from "@open-harness/sandbox";

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// ============================================================================
// GitHub Tarball Utilities
// ============================================================================

interface RepoInfo {
  owner: string;
  repo: string;
}

function parseGitHubUrl(url: string): RepoInfo {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

function buildTarballUrl(owner: string, repo: string, ref: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
}

/**
 * Download and extract a GitHub repository tarball into a files map.
 * Returns a Record<string, string> where keys are file paths and values are contents.
 */
async function downloadAndExtractTarball(
  repoUrl: string,
  branch: string = "main",
  token?: string,
): Promise<{ files: Record<string, string>; rootDir: string }> {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const tarballUrl = buildTarballUrl(owner, repo, branch);

  console.log(`📥 Downloading tarball from: ${tarballUrl}`);
  const startTime = performance.now();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "open-harness-hybrid-sandbox-test",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(tarballUrl, { headers });

  if (!response.ok) {
    throw new Error(
      `Failed to download tarball: ${response.status} ${response.statusText}`,
    );
  }

  const downloadTime = performance.now() - startTime;
  console.log(`✅ Download completed in ${downloadTime.toFixed(0)}ms`);

  // Extract tarball
  console.log(`📦 Extracting tarball...`);
  const extractStart = performance.now();

  const files: Record<string, string> = {};
  let rootDir = "";

  // Download and decompress
  const arrayBuffer = await response.arrayBuffer();
  const gzipped = Buffer.from(arrayBuffer);
  const tarData = gunzipSync(gzipped);

  // Simple tar parser (USTAR format)
  // Tar files consist of 512-byte blocks
  let offset = 0;
  while (offset < tarData.length) {
    // Read header (512 bytes)
    const header = tarData.subarray(offset, offset + 512);

    // Check for end of archive (two zero blocks)
    if (header.every((b) => b === 0)) {
      break;
    }

    // Parse header fields
    const name =
      header.subarray(0, 100).toString("utf-8").split("\x00")[0] ?? "";
    const sizeOctal = header.subarray(124, 136).toString("utf-8").trim();
    const typeFlag = String.fromCharCode(header[156]!);

    // Parse size (octal string)
    const size = parseInt(sizeOctal, 8) || 0;

    // Move past header
    offset += 512;

    // Extract root directory from first entry
    if (!rootDir && name.includes("/")) {
      rootDir = name.split("/")[0]!;
    }

    // Only process regular files (typeFlag '0' or empty)
    if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      // Remove root directory prefix
      const relativePath = name.replace(`${rootDir}/`, "");

      if (relativePath && size > 0) {
        // Read file content
        const content = tarData
          .subarray(offset, offset + size)
          .toString("utf-8");
        files[`/repo/${relativePath}`] = content;
      }
    }

    // Move to next entry (content is padded to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }

  const extractTime = performance.now() - extractStart;
  const fileCount = Object.keys(files).length;
  const totalSize = Object.values(files).reduce(
    (acc, content) => acc + content.length,
    0,
  );

  console.log(
    `✅ Extracted ${fileCount} files (${formatBytes(totalSize)}) in ${extractTime.toFixed(0)}ms`,
  );

  return { files, rootDir };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Sandbox Creation
// ============================================================================

async function createJustBashWithRepo(
  repoUrl: string,
  branch: string,
): Promise<{ sandbox: Sandbox; loadTime: number }> {
  const overallStart = performance.now();

  const { files } = await downloadAndExtractTarball(
    repoUrl,
    branch,
    GITHUB_TOKEN,
  );

  const sandboxStart = performance.now();
  const sandbox = await createJustBashSandbox({
    workingDirectory: "/repo",
    files,
    mode: "memory",
  });
  const sandboxTime = performance.now() - sandboxStart;
  console.log(`✅ JustBash sandbox created in ${sandboxTime.toFixed(0)}ms`);

  const loadTime = performance.now() - overallStart;
  return { sandbox, loadTime };
}

async function createVercelWithRepo(
  repoUrl: string,
  branch: string,
): Promise<{ sandbox: Sandbox; loadTime: number }> {
  const startTime = performance.now();

  console.log(`☁️  Starting Vercel sandbox...`);

  const sandbox = await connectVercelSandbox({
    source: {
      url: repoUrl,
      branch,
      token: GITHUB_TOKEN,
    },
    timeout: 300_000,
  });

  const loadTime = performance.now() - startTime;
  console.log(`✅ Vercel sandbox ready in ${loadTime.toFixed(0)}ms`);

  return { sandbox, loadTime };
}

// ============================================================================
// Test Operations
// ============================================================================

async function testReadOperations(
  sandbox: Sandbox,
  label: string,
): Promise<void> {
  console.log(`\n📖 Testing read operations on ${label}...`);

  const testStart = performance.now();

  // Test 1: Read a common file
  try {
    const packageJson = await sandbox.readFile(
      `${sandbox.workingDirectory}/package.json`,
      "utf-8",
    );
    const pkg = JSON.parse(packageJson);
    console.log(`  ✅ Read package.json - name: ${pkg.name}`);
  } catch (error) {
    console.log(`  ❌ Failed to read package.json: ${error}`);
  }

  // Test 2: List root directory
  try {
    const entries = await sandbox.readdir(sandbox.workingDirectory, {
      withFileTypes: true,
    });
    console.log(`  ✅ Listed directory - ${entries.length} entries`);
  } catch (error) {
    console.log(`  ❌ Failed to list directory: ${error}`);
  }

  // Test 3: Execute a simple command
  try {
    const result = await sandbox.exec(
      "ls -la | head -10",
      sandbox.workingDirectory,
      5000,
    );
    if (result.success) {
      console.log(`  ✅ Executed ls command`);
    } else {
      console.log(`  ⚠️  ls command failed: ${result.stderr}`);
    }
  } catch (error) {
    console.log(`  ❌ Failed to execute command: ${error}`);
  }

  const testTime = performance.now() - testStart;
  console.log(`  ⏱️  Read operations completed in ${testTime.toFixed(0)}ms`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
Usage: bun run apps/cli/hybrid-sandbox-test.ts <github-repo-url> [branch]

Example:
  bun run apps/cli/hybrid-sandbox-test.ts https://github.com/vercel/ai main

Environment:
  GITHUB_TOKEN - Optional GitHub token for private repos and higher rate limits
`);
    process.exit(1);
  }

  const repoUrl = args[0]!;
  const branch = args[1] ?? "main";

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                    Hybrid Sandbox Test                             ║
╠════════════════════════════════════════════════════════════════════╣
║  Repository: ${repoUrl.padEnd(50)}  ║
║  Branch:     ${branch.padEnd(50)}  ║
╚════════════════════════════════════════════════════════════════════╝
`);

  // -------------------------------------------------------------------------
  // Test 1: JustBash with tarball (simulating hybrid start)
  // -------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("TEST 1: JustBash Sandbox with GitHub Tarball");
  console.log("═".repeat(70) + "\n");

  let justBashSandbox: Sandbox | undefined;
  let justBashTime = 0;

  try {
    const result = await createJustBashWithRepo(repoUrl, branch);
    justBashSandbox = result.sandbox;
    justBashTime = result.loadTime;
    await testReadOperations(justBashSandbox, "JustBash");
  } catch (error) {
    console.error(`❌ JustBash test failed: ${error}`);
  }

  // -------------------------------------------------------------------------
  // Test 2: Vercel sandbox (baseline)
  // -------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("TEST 2: Vercel Sandbox (Baseline)");
  console.log("═".repeat(70) + "\n");

  let vercelSandbox: Sandbox | undefined;
  let vercelTime = 0;

  try {
    const result = await createVercelWithRepo(repoUrl, branch);
    vercelSandbox = result.sandbox;
    vercelTime = result.loadTime;
    await testReadOperations(vercelSandbox, "Vercel");
  } catch (error) {
    console.error(`❌ Vercel test failed: ${error}`);
  }

  // -------------------------------------------------------------------------
  // Test 3: Parallel startup (hybrid simulation)
  // -------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("TEST 3: Parallel Startup (Hybrid Simulation)");
  console.log("═".repeat(70) + "\n");

  const parallelStart = performance.now();

  console.log("🚀 Starting both sandboxes in parallel...\n");

  const [justBashResult, vercelResult] = await Promise.allSettled([
    createJustBashWithRepo(repoUrl, branch),
    createVercelWithRepo(repoUrl, branch),
  ]);

  let parallelJustBashTime = 0;
  let parallelVercelTime = 0;

  if (justBashResult.status === "fulfilled") {
    parallelJustBashTime = justBashResult.value.loadTime;
    console.log(
      `\n✅ JustBash ready at ${parallelJustBashTime.toFixed(0)}ms (agent can start exploring!)`,
    );
    await justBashResult.value.sandbox.stop();
  }

  if (vercelResult.status === "fulfilled") {
    parallelVercelTime = vercelResult.value.loadTime;
    console.log(
      `✅ Vercel ready at ${parallelVercelTime.toFixed(0)}ms (agent can now write/commit)`,
    );
    await vercelResult.value.sandbox.stop();
  }

  const parallelTotal = performance.now() - parallelStart;

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n" + "═".repeat(70));
  console.log("SUMMARY");
  console.log("═".repeat(70));
  console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ Metric                          │ Time                             │
├────────────────────────────────────────────────────────────────────┤
│ JustBash (tarball download)     │ ${justBashTime.toFixed(0).padStart(8)}ms                        │
│ Vercel (git clone)              │ ${vercelTime.toFixed(0).padStart(8)}ms                        │
│ Parallel total                  │ ${parallelTotal.toFixed(0).padStart(8)}ms                        │
├────────────────────────────────────────────────────────────────────┤
│ Time saved (perceived)          │ ${(vercelTime - parallelJustBashTime).toFixed(0).padStart(8)}ms                        │
│ User can start exploring at     │ ${parallelJustBashTime.toFixed(0).padStart(8)}ms (vs ${vercelTime.toFixed(0)}ms)        │
└────────────────────────────────────────────────────────────────────┘

Conclusion:
  ${
    parallelJustBashTime < vercelTime / 2
      ? "✅ Hybrid approach shows significant improvement!"
      : "⚠️  Hybrid approach may not provide significant benefit for this repo."
  }

  With the hybrid approach:
  - User sees activity in ~${parallelJustBashTime.toFixed(0)}ms instead of waiting ${vercelTime.toFixed(0)}ms
  - Agent can immediately start reading and exploring the codebase
  - Full write/git capabilities available after ~${vercelTime.toFixed(0)}ms
`);

  // Cleanup
  if (justBashSandbox) await justBashSandbox.stop();
  if (vercelSandbox) await vercelSandbox.stop();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
