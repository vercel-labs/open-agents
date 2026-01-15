/**
 * Pending Operations Replay Test
 *
 * This script tests the final piece of hybrid sandbox viability:
 * applying serialized pending operations from JustBash to a real Vercel sandbox.
 *
 * Flow:
 *   1. Create JustBash with GitHub tarball
 *   2. Make modifications (track as pending operations)
 *   3. Serialize JustBash state + pending ops (simulating DB storage)
 *   4. Create Vercel sandbox
 *   5. Replay pending operations to Vercel
 *   6. Verify files exist in Vercel
 *
 * Usage:
 *   bun run apps/web/pending-ops-replay-test.ts <github-repo-url> [branch]
 *
 * Example:
 *   bun run apps/web/pending-ops-replay-test.ts https://github.com/vercel-labs/ai-sdk-preview-rag main
 */

import { gunzipSync } from "zlib";
import { Bash } from "just-bash";
import {
  createJustBashSandbox,
  connectVercelSandbox,
  type Sandbox,
} from "@open-harness/sandbox";

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WORKING_DIR = "/vercel/sandbox";

// ============================================================================
// Types
// ============================================================================

interface PendingOperation {
  type: "writeFile" | "mkdir";
  path: string;
  content?: string;
  recursive?: boolean;
}

interface JustBashSnapshot {
  workingDirectory: string;
  env: Record<string, string>;
  files: Record<
    string,
    {
      type: "file" | "directory" | "symlink";
      content?: string;
      encoding?: "base64";
      mode?: number;
      target?: string;
    }
  >;
}

/**
 * Full hybrid sandbox state that would be persisted to database
 */
interface PersistedHybridState {
  state: "justbash" | "vercel";
  justBashSnapshot: JustBashSnapshot | null;
  pendingOperations: PendingOperation[];
  vercelSandboxId: string | null;
}

interface FsEntry {
  type: "file" | "directory" | "symlink";
  content?: Uint8Array;
  mode?: number;
  target?: string;
}

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

async function downloadAndExtractTarball(
  repoUrl: string,
  branch: string = "main",
  token?: string,
): Promise<Record<string, string>> {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "open-harness-pending-ops-test",
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

  const files: Record<string, string> = {};
  let rootDir = "";

  const arrayBuffer = await response.arrayBuffer();
  const gzipped = Buffer.from(arrayBuffer);
  const tarData = gunzipSync(gzipped);

  let offset = 0;
  while (offset < tarData.length) {
    const header = tarData.subarray(offset, offset + 512);

    if (header.every((b) => b === 0)) {
      break;
    }

    const name =
      header.subarray(0, 100).toString("utf-8").split("\x00")[0] ?? "";
    const sizeOctal = header.subarray(124, 136).toString("utf-8").trim();
    const typeFlag = String.fromCharCode(header[156]!);

    const size = parseInt(sizeOctal, 8) || 0;
    offset += 512;

    if (!rootDir && name.includes("/")) {
      rootDir = name.split("/")[0]!;
    }

    if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      const relativePath = name.replace(`${rootDir}/`, "");

      if (relativePath && size > 0) {
        const content = tarData
          .subarray(offset, offset + size)
          .toString("utf-8");
        files[`${WORKING_DIR}/${relativePath}`] = content;
      }
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

// ============================================================================
// Serialization Functions
// ============================================================================

function serializeJustBash(bash: Bash, workingDir: string): JustBashSnapshot {
  const snapshot: JustBashSnapshot = {
    workingDirectory: bash.getCwd(),
    env: bash.getEnv(),
    files: {},
  };

  const fsData = bash.fs.data as Map<string, FsEntry>;

  for (const [path, entry] of fsData) {
    if (!path.startsWith(workingDir) && path !== workingDir) {
      continue;
    }

    if (entry.type === "file" && entry.content) {
      try {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          entry.content,
        );
        snapshot.files[path] = { type: "file", content, mode: entry.mode };
      } catch {
        const base64 = Buffer.from(entry.content).toString("base64");
        snapshot.files[path] = {
          type: "file",
          content: base64,
          encoding: "base64",
          mode: entry.mode,
        };
      }
    } else if (entry.type === "directory") {
      snapshot.files[path] = { type: "directory", mode: entry.mode };
    } else if (entry.type === "symlink" && entry.target) {
      snapshot.files[path] = { type: "symlink", target: entry.target };
    }
  }

  return snapshot;
}

function deserializeJustBash(snapshot: JustBashSnapshot): Bash {
  const files: Record<string, string> = {};

  for (const [path, entry] of Object.entries(snapshot.files)) {
    if (entry.type === "file" && entry.content) {
      if (entry.encoding === "base64") {
        files[path] = Buffer.from(entry.content, "base64").toString("utf-8");
      } else {
        files[path] = entry.content;
      }
    }
  }

  return new Bash({
    files,
    cwd: snapshot.workingDirectory,
    env: snapshot.env,
  });
}

// ============================================================================
// Pending Operations Replay
// ============================================================================

async function replayPendingOperations(
  sandbox: Sandbox,
  operations: PendingOperation[],
): Promise<{ replayed: number; errors: string[] }> {
  const errors: string[] = [];
  let replayed = 0;

  for (const op of operations) {
    try {
      if (op.type === "writeFile" && op.content !== undefined) {
        console.log(`  Replaying writeFile: ${op.path}`);
        await sandbox.writeFile(op.path, op.content, "utf-8");
        replayed++;
      } else if (op.type === "mkdir") {
        console.log(`  Replaying mkdir: ${op.path}`);
        await sandbox.mkdir(op.path, { recursive: op.recursive ?? false });
        replayed++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to replay ${op.type} ${op.path}: ${message}`);
    }
  }

  return { replayed, errors };
}

// ============================================================================
// Test Scenarios
// ============================================================================

async function runTest(repoUrl: string, branch: string): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║            Pending Operations Replay Test                          ║
╠════════════════════════════════════════════════════════════════════╣
║  Testing: Serialize pending ops -> Apply to Vercel                  ║
╚════════════════════════════════════════════════════════════════════╝
`);

  // =========================================================================
  // Phase 1: Create JustBash and make modifications
  // =========================================================================
  console.log(`${"═".repeat(60)}`);
  console.log(`Phase 1: Create JustBash and Track Pending Operations`);
  console.log(`${"═".repeat(60)}\n`);

  console.log(`[Setup] Downloading tarball...`);
  const downloadStart = performance.now();
  const files = await downloadAndExtractTarball(repoUrl, branch, GITHUB_TOKEN);
  const downloadTime = performance.now() - downloadStart;
  console.log(
    `[Setup] Downloaded ${Object.keys(files).length} files in ${downloadTime.toFixed(0)}ms`,
  );

  console.log(`[Setup] Creating JustBash sandbox...`);
  const justBash = await createJustBashSandbox({
    workingDirectory: WORKING_DIR,
    files,
    mode: "memory",
  });
  console.log(`[Setup] JustBash ready at ${justBash.workingDirectory}`);

  // Track pending operations (simulating what HybridSandbox does)
  const pendingOperations: PendingOperation[] = [];

  // Simulate agent making changes
  console.log(`\n[Agent] Making modifications...`);

  // Write 1: Create a new config file
  const configContent = JSON.stringify(
    {
      hybrid: true,
      timestamp: new Date().toISOString(),
      test: "pending-ops-replay",
    },
    null,
    2,
  );
  await justBash.writeFile(
    `${WORKING_DIR}/hybrid-config.json`,
    configContent,
    "utf-8",
  );
  pendingOperations.push({
    type: "writeFile",
    path: `${WORKING_DIR}/hybrid-config.json`,
    content: configContent,
  });
  console.log(`[Agent] Created hybrid-config.json`);

  // Write 2: Create a new directory and file
  await justBash.mkdir(`${WORKING_DIR}/generated`, { recursive: true });
  pendingOperations.push({
    type: "mkdir",
    path: `${WORKING_DIR}/generated`,
    recursive: true,
  });
  console.log(`[Agent] Created generated/ directory`);

  const generatedContent = `// Auto-generated by hybrid sandbox test
export const testValue = ${Date.now()};
export const message = "Hello from JustBash!";
`;
  await justBash.writeFile(
    `${WORKING_DIR}/generated/output.ts`,
    generatedContent,
    "utf-8",
  );
  pendingOperations.push({
    type: "writeFile",
    path: `${WORKING_DIR}/generated/output.ts`,
    content: generatedContent,
  });
  console.log(`[Agent] Created generated/output.ts`);

  // Write 3: Modify an existing file (append to README or create notes)
  const notesContent = `# Hybrid Sandbox Test Notes

This file was created during the pending operations replay test.

- Created: ${new Date().toISOString()}
- Sandbox: JustBash (in-memory)
- Target: Vercel sandbox
`;
  await justBash.writeFile(`${WORKING_DIR}/NOTES.md`, notesContent, "utf-8");
  pendingOperations.push({
    type: "writeFile",
    path: `${WORKING_DIR}/NOTES.md`,
    content: notesContent,
  });
  console.log(`[Agent] Created NOTES.md`);

  console.log(
    `\n[Summary] ${pendingOperations.length} pending operations tracked`,
  );

  // =========================================================================
  // Phase 2: Serialize state (simulating end of serverless request)
  // =========================================================================
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 2: Serialize State for Persistence`);
  console.log(`${"═".repeat(60)}\n`);

  // Access internal Bash for serialization
  const internalBash = (justBash as unknown as { bash: Bash }).bash;
  if (!internalBash) {
    throw new Error("Could not access internal Bash instance");
  }

  console.log(`[Serialize] Creating JustBash snapshot...`);
  const justBashSnapshot = serializeJustBash(internalBash, WORKING_DIR);

  // Create full persisted state
  const persistedState: PersistedHybridState = {
    state: "justbash",
    justBashSnapshot,
    pendingOperations,
    vercelSandboxId: null,
  };

  // Simulate database storage (JSON stringify)
  console.log(`[Serialize] Simulating database storage...`);
  const serializedState = JSON.stringify(persistedState);
  console.log(
    `[Serialize] Persisted state size: ${(serializedState.length / 1024).toFixed(1)} KB`,
  );
  console.log(
    `[Serialize] - JustBash snapshot: ${Object.keys(justBashSnapshot.files).length} files`,
  );
  console.log(
    `[Serialize] - Pending operations: ${pendingOperations.length} ops`,
  );

  // Stop JustBash (end of request 1)
  await justBash.stop();
  console.log(`[Serialize] JustBash stopped (request 1 complete)`);

  // =========================================================================
  // Phase 3: Restore state and apply to Vercel (request 2)
  // =========================================================================
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 3: Restore and Apply to Vercel Sandbox`);
  console.log(`${"═".repeat(60)}\n`);

  // Simulate database read (JSON parse)
  console.log(`[Restore] Loading persisted state from "database"...`);
  const restoredState = JSON.parse(serializedState) as PersistedHybridState;
  console.log(`[Restore] State: ${restoredState.state}`);
  console.log(
    `[Restore] Pending operations: ${restoredState.pendingOperations.length}`,
  );

  // Create Vercel sandbox
  console.log(`\n[Vercel] Creating Vercel sandbox...`);
  const vercelStart = performance.now();
  const vercelSandbox = await connectVercelSandbox({
    source: { url: repoUrl, branch, token: GITHUB_TOKEN },
    timeout: 300_000,
  });
  const vercelTime = performance.now() - vercelStart;
  console.log(`[Vercel] Sandbox ready in ${vercelTime.toFixed(0)}ms`);
  console.log(`[Vercel] Working directory: ${vercelSandbox.workingDirectory}`);

  // Replay pending operations
  console.log(
    `\n[Replay] Applying ${restoredState.pendingOperations.length} pending operations to Vercel...`,
  );
  const replayStart = performance.now();
  const { replayed, errors } = await replayPendingOperations(
    vercelSandbox,
    restoredState.pendingOperations,
  );
  const replayTime = performance.now() - replayStart;

  console.log(`\n[Replay] Completed in ${replayTime.toFixed(0)}ms`);
  console.log(
    `[Replay] Replayed: ${replayed}/${restoredState.pendingOperations.length} operations`,
  );
  if (errors.length > 0) {
    console.log(`[Replay] Errors: ${errors.join(", ")}`);
  }

  // =========================================================================
  // Phase 4: Verify files exist in Vercel
  // =========================================================================
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 4: Verify Files in Vercel Sandbox`);
  console.log(`${"═".repeat(60)}\n`);

  const verifications: {
    file: string;
    exists: boolean;
    contentMatch: boolean;
  }[] = [];

  // Verify each file we created
  const filesToVerify = [
    {
      path: `${vercelSandbox.workingDirectory}/hybrid-config.json`,
      expectedContent: configContent,
    },
    {
      path: `${vercelSandbox.workingDirectory}/generated/output.ts`,
      expectedContent: generatedContent,
    },
    {
      path: `${vercelSandbox.workingDirectory}/NOTES.md`,
      expectedContent: notesContent,
    },
  ];

  for (const { path, expectedContent } of filesToVerify) {
    try {
      const content = await vercelSandbox.readFile(path, "utf-8");
      const contentMatch = content === expectedContent;
      verifications.push({ file: path, exists: true, contentMatch });
      console.log(
        `[Verify] ${path.split("/").pop()}: EXISTS ${contentMatch ? "✓" : "(content mismatch)"}`,
      );
      if (!contentMatch) {
        console.log(
          `  Expected length: ${expectedContent.length}, Got: ${content.length}`,
        );
      }
    } catch (error) {
      verifications.push({ file: path, exists: false, contentMatch: false });
      console.log(`[Verify] ${path.split("/").pop()}: MISSING ✗`);
    }
  }

  // Also verify via ls command
  console.log(`\n[Verify] Listing generated/ directory in Vercel...`);
  const lsResult = await vercelSandbox.exec(
    "ls -la generated/",
    vercelSandbox.workingDirectory,
    5000,
  );
  console.log(lsResult.stdout);

  // Cleanup
  await vercelSandbox.stop();

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Summary`);
  console.log(`${"═".repeat(60)}`);

  const allVerified = verifications.every((v) => v.exists && v.contentMatch);

  console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ Results                                                            │
├────────────────────────────────────────────────────────────────────┤
│ Pending operations tracked    │ ${String(pendingOperations.length).padStart(4)}                              │
│ Operations replayed to Vercel │ ${String(replayed).padStart(4)}                              │
│ Files verified in Vercel      │ ${String(verifications.filter((v) => v.exists).length).padStart(4)}/${verifications.length}                            │
│ Content matches               │ ${String(verifications.filter((v) => v.contentMatch).length).padStart(4)}/${verifications.length}                            │
├────────────────────────────────────────────────────────────────────┤
│ Overall Result                │ ${allVerified ? "PASSED ✓" : "FAILED ✗"}                            │
└────────────────────────────────────────────────────────────────────┘

Timing:
  - Tarball download: ${downloadTime.toFixed(0)}ms
  - Vercel startup: ${vercelTime.toFixed(0)}ms
  - Replay operations: ${replayTime.toFixed(0)}ms

Key Validation:
  ${allVerified ? "✓ Pending operations from JustBash successfully applied to Vercel" : "✗ Some operations failed to apply"}
  ${allVerified ? "✓ Files created in JustBash exist in Vercel with correct content" : "✗ Content verification failed"}
  ${allVerified ? "✓ Hybrid sandbox architecture is viable for production" : "✗ Issues need investigation"}
`);

  if (!allVerified) {
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
Usage: bun run apps/web/pending-ops-replay-test.ts <github-repo-url> [branch]

Example:
  bun run apps/web/pending-ops-replay-test.ts https://github.com/vercel-labs/ai-sdk-preview-rag main

Environment:
  GITHUB_TOKEN - Optional GitHub token for private repos and higher rate limits
`);
    process.exit(1);
  }

  const repoUrl = args[0]!;
  const branch = args[1] ?? "main";

  await runTest(repoUrl, branch);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
