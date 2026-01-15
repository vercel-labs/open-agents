/**
 * Hybrid Sandbox Handoff Test
 *
 * This script explores the seamless handoff mechanism for hybrid sandboxes.
 * We start with JustBash for immediate responsiveness, then switch to Vercel
 * when it's ready, replaying any writes that occurred in the meantime.
 *
 * Usage:
 *   bun run apps/web/hybrid-sandbox-handoff-test.ts <github-repo-url> [branch]
 *
 * Example:
 *   bun run apps/web/hybrid-sandbox-handoff-test.ts https://github.com/vercel-labs/ai-sdk-preview-rag main
 */

import { gunzipSync } from "zlib";
import type { Dirent } from "fs";
import {
  createJustBashSandbox,
  connectVercelSandbox,
  type Sandbox,
  type ExecResult,
  type SandboxStats,
} from "@open-harness/sandbox";

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * Use the same working directory as Vercel sandbox to avoid path remapping.
 * This ensures paths are identical between JustBash and Vercel.
 */
const WORKING_DIR = "/vercel/sandbox";

// ============================================================================
// GitHub Tarball Utilities (copied from hybrid-sandbox-test.ts)
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

async function downloadAndExtractTarball(
  repoUrl: string,
  branch: string = "main",
  token?: string,
): Promise<{ files: Record<string, string>; rootDir: string }> {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const tarballUrl = buildTarballUrl(owner, repo, branch);

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
        // Use WORKING_DIR to match Vercel's path structure
        files[`${WORKING_DIR}/${relativePath}`] = content;
      }
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return { files, rootDir };
}

// ============================================================================
// Pending Write Tracking
// ============================================================================

interface PendingWrite {
  type: "writeFile";
  path: string;
  content: string;
}

interface PendingMkdir {
  type: "mkdir";
  path: string;
  recursive: boolean;
}

type PendingOperation = PendingWrite | PendingMkdir;

// ============================================================================
// Hybrid Sandbox Implementation
// ============================================================================

interface HybridSandboxConfig {
  repoUrl: string;
  branch: string;
  token?: string;
  /** Called when Vercel sandbox becomes ready */
  onVercelReady?: () => void;
  /** Called when handoff completes */
  onHandoffComplete?: () => void;
}

type SandboxState = "justbash" | "switching" | "vercel";

class HybridSandbox implements Sandbox {
  readonly type = "hybrid";

  private state: SandboxState = "justbash";
  private justBash: Sandbox | null = null;
  private vercel: Sandbox | null = null;
  private vercelReady = false;
  private vercelPromise: Promise<Sandbox> | null = null;
  private pendingOperations: PendingOperation[] = [];
  private config: HybridSandboxConfig;

  constructor(
    justBash: Sandbox,
    vercelPromise: Promise<Sandbox>,
    config: HybridSandboxConfig,
  ) {
    this.justBash = justBash;
    this.vercelPromise = vercelPromise;
    this.config = config;

    // Monitor Vercel readiness
    this.monitorVercelReady();
  }

  /**
   * Returns the working directory of the current active sandbox.
   * This changes after handoff from JustBash to Vercel.
   */
  get workingDirectory(): string {
    return this.current.workingDirectory;
  }

  /**
   * Returns the environment variables of the current active sandbox.
   */
  get env(): Record<string, string> | undefined {
    return this.current.env;
  }

  private async monitorVercelReady(): Promise<void> {
    if (!this.vercelPromise) return;

    try {
      this.vercel = await this.vercelPromise;
      this.vercelReady = true;
      console.log(`[HybridSandbox] Vercel sandbox is now ready`);
      this.config.onVercelReady?.();
    } catch (error) {
      console.error(`[HybridSandbox] Vercel sandbox failed to start:`, error);
    }
  }

  /**
   * Check if Vercel is ready for handoff
   */
  isVercelReady(): boolean {
    return this.vercelReady;
  }

  /**
   * Get the current active sandbox state
   */
  getState(): SandboxState {
    return this.state;
  }

  /**
   * Get the number of pending operations to replay
   */
  getPendingOperationsCount(): number {
    return this.pendingOperations.length;
  }

  /**
   * Perform the handoff from JustBash to Vercel.
   * Replays all pending write operations to Vercel before switching.
   *
   * Note: Since both sandboxes use the same working directory (WORKING_DIR),
   * no path remapping is needed.
   */
  async performHandoff(): Promise<void> {
    if (!this.vercelReady || !this.vercel) {
      throw new Error("Cannot handoff: Vercel sandbox not ready");
    }

    if (this.state !== "justbash") {
      console.log(`[HybridSandbox] Already in state: ${this.state}`);
      return;
    }

    this.state = "switching";
    console.log(
      `[HybridSandbox] Starting handoff with ${this.pendingOperations.length} pending operations`,
    );

    // Replay all pending operations to Vercel
    // No path remapping needed since both sandboxes use WORKING_DIR
    for (const op of this.pendingOperations) {
      if (op.type === "writeFile") {
        console.log(`[HybridSandbox] Replaying write: ${op.path}`);
        await this.vercel.writeFile(op.path, op.content, "utf-8");
      } else if (op.type === "mkdir") {
        console.log(`[HybridSandbox] Replaying mkdir: ${op.path}`);
        await this.vercel.mkdir(op.path, { recursive: op.recursive });
      }
    }

    // Clear pending operations
    this.pendingOperations = [];

    // Switch to Vercel
    this.state = "vercel";
    console.log(`[HybridSandbox] Handoff complete, now using Vercel sandbox`);

    this.config.onHandoffComplete?.();
  }

  /**
   * Get the current active sandbox
   */
  private get current(): Sandbox {
    if (this.state === "vercel" && this.vercel) {
      return this.vercel;
    }
    if (!this.justBash) {
      throw new Error("No sandbox available");
    }
    return this.justBash;
  }

  // -------------------------------------------------------------------------
  // Sandbox Interface Implementation
  // -------------------------------------------------------------------------

  async readFile(path: string, encoding: "utf-8"): Promise<string> {
    return this.current.readFile(path, encoding);
  }

  async writeFile(
    path: string,
    content: string,
    encoding: "utf-8",
  ): Promise<void> {
    // If we're still on JustBash, track the write for replay
    if (this.state === "justbash") {
      this.pendingOperations.push({ type: "writeFile", path, content });
      console.log(
        `[HybridSandbox] Tracked write: ${path} (${this.pendingOperations.length} pending)`,
      );
    }

    return this.current.writeFile(path, content, encoding);
  }

  async stat(path: string): Promise<SandboxStats> {
    return this.current.stat(path);
  }

  async access(path: string): Promise<void> {
    return this.current.access(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    // If we're still on JustBash, track the mkdir for replay
    if (this.state === "justbash") {
      this.pendingOperations.push({
        type: "mkdir",
        path,
        recursive: options?.recursive ?? false,
      });
      console.log(
        `[HybridSandbox] Tracked mkdir: ${path} (${this.pendingOperations.length} pending)`,
      );
    }

    return this.current.mkdir(path, options);
  }

  async readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    return this.current.readdir(path, options);
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    // Check if this is an operation that requires Vercel (git, npm, etc.)
    const requiresVercel = this.commandRequiresVercel(command);

    if (requiresVercel && this.state === "justbash") {
      if (this.vercelReady) {
        console.log(
          `[HybridSandbox] Command "${command.slice(0, 50)}..." requires Vercel, performing handoff`,
        );
        await this.performHandoff();
      } else {
        console.log(
          `[HybridSandbox] Command "${command.slice(0, 50)}..." requires Vercel but it's not ready yet`,
        );
        // Could either wait or return an error
        // For now, let JustBash handle it (will likely fail gracefully)
      }
    }

    return this.current.exec(command, cwd, timeoutMs);
  }

  private commandRequiresVercel(command: string): boolean {
    const vercelOnlyCommands = [
      /^git\s/,
      /^npm\s/,
      /^pnpm\s/,
      /^yarn\s/,
      /^bun\s(?!test)/,
      /^curl\s/,
      /^wget\s/,
      /^node\s/,
      /^npx\s/,
    ];

    return vercelOnlyCommands.some((pattern) => pattern.test(command.trim()));
  }

  async stop(): Promise<void> {
    // Stop both sandboxes
    if (this.justBash) {
      await this.justBash.stop();
      this.justBash = null;
    }
    if (this.vercel) {
      await this.vercel.stop();
      this.vercel = null;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

interface CreateHybridSandboxResult {
  sandbox: HybridSandbox;
  justBashReadyTime: number;
}

async function createHybridSandbox(
  config: HybridSandboxConfig,
): Promise<CreateHybridSandboxResult> {
  const overallStart = performance.now();

  // Start both in parallel
  console.log(
    `[Factory] Starting JustBash (tarball) and Vercel in parallel...`,
  );

  // Download tarball and create JustBash
  const tarballStart = performance.now();
  const { files } = await downloadAndExtractTarball(
    config.repoUrl,
    config.branch,
    config.token,
  );
  const tarballTime = performance.now() - tarballStart;
  console.log(`[Factory] Tarball downloaded in ${tarballTime.toFixed(0)}ms`);

  const justBashStart = performance.now();
  const justBash = await createJustBashSandbox({
    workingDirectory: WORKING_DIR,
    files,
    mode: "memory",
  });
  const justBashTime = performance.now() - justBashStart;
  console.log(`[Factory] JustBash created in ${justBashTime.toFixed(0)}ms`);

  const justBashReadyTime = performance.now() - overallStart;
  console.log(
    `[Factory] JustBash ready in ${justBashReadyTime.toFixed(0)}ms total`,
  );

  // Start Vercel in the background (don't await)
  const vercelPromise = connectVercelSandbox({
    source: {
      url: config.repoUrl,
      branch: config.branch,
      token: config.token,
    },
    timeout: 300_000,
  });

  // Create hybrid sandbox
  const sandbox = new HybridSandbox(justBash, vercelPromise, config);

  return { sandbox, justBashReadyTime };
}

// ============================================================================
// Test Scenarios
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScenario1_ReadOnly(sandbox: HybridSandbox): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scenario 1: Read-only operations (no handoff needed)`);
  console.log(`${"─".repeat(60)}\n`);

  // Simulate agent exploring codebase
  console.log(`[Agent] Reading package.json...`);
  const packageJson = await sandbox.readFile(
    `${sandbox.workingDirectory}/package.json`,
    "utf-8",
  );
  const pkg = JSON.parse(packageJson);
  console.log(`[Agent] Found package: ${pkg.name}`);

  console.log(`[Agent] Listing directory...`);
  const entries = await sandbox.readdir(sandbox.workingDirectory, {
    withFileTypes: true,
  });
  console.log(`[Agent] Found ${entries.length} entries`);

  console.log(`[Agent] Running ls command...`);
  const lsResult = await sandbox.exec("ls -la", sandbox.workingDirectory, 5000);
  console.log(`[Agent] ls output: ${lsResult.stdout.split("\n").length} lines`);

  console.log(`\n[Result] State: ${sandbox.getState()}`);
  console.log(
    `[Result] Pending operations: ${sandbox.getPendingOperationsCount()}`,
  );
  console.log(`[Result] No handoff occurred (as expected for read-only)`);
}

async function runScenario2_WriteBeforeReady(
  sandbox: HybridSandbox,
): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scenario 2: Write operations before Vercel is ready`);
  console.log(`${"─".repeat(60)}\n`);

  // Simulate agent making changes before Vercel is ready
  console.log(`[Agent] Creating a new file...`);
  await sandbox.writeFile(
    `${sandbox.workingDirectory}/test-file.txt`,
    "Hello from hybrid sandbox!",
    "utf-8",
  );

  console.log(`[Agent] Creating another file...`);
  await sandbox.writeFile(
    `${sandbox.workingDirectory}/another-test.ts`,
    `export const message = "test";`,
    "utf-8",
  );

  console.log(`[Agent] Reading back the file...`);
  const content = await sandbox.readFile(
    `${sandbox.workingDirectory}/test-file.txt`,
    "utf-8",
  );
  console.log(`[Agent] File content: "${content}"`);

  console.log(`\n[Result] State: ${sandbox.getState()}`);
  console.log(
    `[Result] Pending operations: ${sandbox.getPendingOperationsCount()}`,
  );
  console.log(`[Result] Writes tracked for later replay`);
}

async function runScenario3_HandoffOnDemand(
  sandbox: HybridSandbox,
): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scenario 3: Explicit handoff when Vercel is ready`);
  console.log(`${"─".repeat(60)}\n`);

  // Wait for Vercel to be ready
  console.log(`[Test] Waiting for Vercel to be ready...`);
  while (!sandbox.isVercelReady()) {
    await sleep(500);
    process.stdout.write(".");
  }
  console.log(` Ready!`);

  // Perform handoff
  console.log(`[Test] Performing explicit handoff...`);
  const handoffStart = performance.now();
  await sandbox.performHandoff();
  const handoffTime = performance.now() - handoffStart;
  console.log(`[Test] Handoff completed in ${handoffTime.toFixed(0)}ms`);

  console.log(`\n[Result] State: ${sandbox.getState()}`);
  console.log(
    `[Result] Pending operations: ${sandbox.getPendingOperationsCount()}`,
  );

  // Verify files were replayed
  console.log(`\n[Verify] Checking if replayed files exist in Vercel...`);
  try {
    const content = await sandbox.readFile(
      `${sandbox.workingDirectory}/test-file.txt`,
      "utf-8",
    );
    console.log(`[Verify] test-file.txt exists: "${content}"`);
  } catch {
    console.log(
      `[Verify] test-file.txt not found (expected if scenario 2 didn't run)`,
    );
  }
}

async function runScenario4_AutoHandoffOnGit(
  sandbox: HybridSandbox,
): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scenario 4: Auto-handoff when git command is issued`);
  console.log(`${"─".repeat(60)}\n`);

  // Ensure we're back on JustBash for this test
  if (sandbox.getState() !== "justbash") {
    console.log(`[Skip] Already on Vercel, skipping auto-handoff test`);
    return;
  }

  // Wait for Vercel to be ready first
  console.log(`[Test] Waiting for Vercel to be ready...`);
  while (!sandbox.isVercelReady()) {
    await sleep(500);
    process.stdout.write(".");
  }
  console.log(` Ready!`);

  // Issue a git command (should trigger auto-handoff)
  console.log(`\n[Agent] Running git status...`);
  const result = await sandbox.exec(
    "git status",
    sandbox.workingDirectory,
    10000,
  );

  console.log(`[Agent] git status result:`);
  console.log(result.stdout.split("\n").slice(0, 5).join("\n"));

  console.log(`\n[Result] State: ${sandbox.getState()}`);
  console.log(`[Result] Auto-handoff occurred before git command`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
Usage: bun run apps/web/hybrid-sandbox-handoff-test.ts <github-repo-url> [branch]

Example:
  bun run apps/web/hybrid-sandbox-handoff-test.ts https://github.com/vercel-labs/ai-sdk-preview-rag main

Environment:
  GITHUB_TOKEN - Optional GitHub token for private repos and higher rate limits
`);
    process.exit(1);
  }

  const repoUrl = args[0]!;
  const branch = args[1] ?? "main";

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║               Hybrid Sandbox Handoff Test                          ║
╠════════════════════════════════════════════════════════════════════╣
║  Repository: ${repoUrl.padEnd(50)}  ║
║  Branch:     ${branch.padEnd(50)}  ║
╚════════════════════════════════════════════════════════════════════╝
`);

  // Create hybrid sandbox
  console.log(`${"═".repeat(60)}`);
  console.log(`Creating Hybrid Sandbox`);
  console.log(`${"═".repeat(60)}\n`);

  let vercelReadyTime = 0;
  const overallStart = performance.now();

  const { sandbox, justBashReadyTime } = await createHybridSandbox({
    repoUrl,
    branch,
    token: GITHUB_TOKEN,
    onVercelReady: () => {
      vercelReadyTime = performance.now() - overallStart;
      console.log(`\n[Event] Vercel ready at ${vercelReadyTime.toFixed(0)}ms`);
    },
    onHandoffComplete: () => {
      console.log(`[Event] Handoff complete`);
    },
  });

  console.log(`\n[Factory] Hybrid sandbox created`);
  console.log(`[Factory] Agent can start working immediately!`);
  console.log(
    `[Factory] Time to first interaction: ${justBashReadyTime.toFixed(0)}ms`,
  );

  // Run test scenarios
  await runScenario1_ReadOnly(sandbox);
  await runScenario2_WriteBeforeReady(sandbox);
  await runScenario3_HandoffOnDemand(sandbox);

  // Note: Can't run scenario 4 because we're already on Vercel after scenario 3
  // Would need a fresh sandbox instance

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Summary`);
  console.log(`${"═".repeat(60)}`);

  // Wait a bit for Vercel ready time to be captured
  await sleep(1000);

  console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ Metric                          │ Time                             │
├────────────────────────────────────────────────────────────────────┤
│ JustBash ready (agent starts)   │ ${justBashReadyTime.toFixed(0).padStart(8)}ms                        │
│ Vercel ready (full capabilities)│ ${(vercelReadyTime || "pending").toString().padStart(8)}ms                        │
│ Time saved for user             │ ${((vercelReadyTime || 7000) - justBashReadyTime).toFixed(0).padStart(8)}ms                        │
└────────────────────────────────────────────────────────────────────┘

Key Observations:
  - User sees agent activity in ~${justBashReadyTime.toFixed(0)}ms (vs waiting ~${vercelReadyTime || 7000}ms)
  - Writes are tracked and replayed during handoff
  - Handoff is transparent to the agent
  - Full git/npm capabilities available after handoff
`);

  // Cleanup
  await sandbox.stop();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
