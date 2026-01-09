import type { Dirent } from "fs";

/**
 * Lifecycle hook that receives the sandbox instance.
 * Use these to run arbitrary setup or teardown code.
 */
export type SandboxHook = (sandbox: Sandbox) => Promise<void>;

/**
 * Configuration for sandbox lifecycle hooks.
 */
export interface SandboxHooks {
  /**
   * Called after the sandbox starts and is ready.
   * Use for setup tasks like configuring credentials, installing dependencies, etc.
   *
   * @example
   * afterStart: async (sandbox) => {
   *   await sandbox.exec('git config user.name "Bot"', sandbox.workingDirectory, 30000);
   * }
   */
  afterStart?: SandboxHook;

  /**
   * Called before the sandbox stops.
   * Use for teardown tasks like committing uncommitted changes, cleanup, etc.
   *
   * @example
   * beforeStop: async (sandbox) => {
   *   const result = await sandbox.exec('git status --porcelain', sandbox.workingDirectory, 30000);
   *   if (result.stdout.trim()) {
   *     await sandbox.exec('git add -A && git commit -m "Auto-commit"', sandbox.workingDirectory, 30000);
   *   }
   * }
   */
  beforeStop?: SandboxHook;
}

/**
 * File stats returned by sandbox.stat()
 * Mirrors the subset of fs.Stats used by the tools
 */
export interface SandboxStats {
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
  mtimeMs: number;
}

/**
 * Result of shell command execution
 */
export interface ExecResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/**
 * Sandbox interface for file system and shell operations.
 *
 * Mirrors the fs/promises API for easy implementation with local fs,
 * but can be implemented by remote sandboxes (Docker, E2B, etc.).
 *
 * Security note: The sandbox does NOT enforce path boundaries.
 * Tools are responsible for validating paths before calling sandbox methods.
 */
export interface Sandbox {
  /**
   * Identifier for the sandbox implementation type.
   * Used to conditionally adjust agent behavior (e.g., disable git instructions).
   */
  readonly type?: string;

  /**
   * The working directory for this sandbox.
   * All path validations should be relative to this directory.
   */
  readonly workingDirectory: string;

  /**
   * Environment variables available to commands in the sandbox.
   * For LocalSandbox, these are merged with process.env.
   * For remote sandboxes, these are the only env vars available.
   */
  readonly env?: Record<string, string>;

  /**
   * The current git branch in the sandbox (if applicable).
   * Useful for agents that need to know which branch they're working on.
   */
  readonly currentBranch?: string;

  /**
   * Lifecycle hooks for this sandbox.
   * Note: afterStart is called automatically during creation.
   * beforeStop is called automatically when stop() is invoked.
   */
  readonly hooks?: SandboxHooks;

  /**
   * Environment-specific details for the agent system prompt.
   * Describes available commands, capabilities, and limitations.
   * Added to the system prompt under the Environment section.
   *
   * @example
   * environmentDetails: "- Git available, GitHub CLI (gh) is NOT available"
   */
  readonly environmentDetails?: string;

  /**
   * Read file contents as UTF-8 string
   */
  readFile(path: string, encoding: "utf-8"): Promise<string>;

  /**
   * Write content to a file (creates or overwrites)
   */
  writeFile(path: string, content: string, encoding: "utf-8"): Promise<void>;

  /**
   * Get file/directory stats
   */
  stat(path: string): Promise<SandboxStats>;

  /**
   * Check if path is accessible (throws if not)
   */
  access(path: string): Promise<void>;

  /**
   * Create directory (optionally recursive)
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Read directory contents with file type info
   */
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;

  /**
   * Execute a shell command
   * @param command - The command to execute
   * @param cwd - Working directory for the command
   * @param timeoutMs - Timeout in milliseconds
   */
  exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult>;

  /**
   * Stop and clean up the sandbox.
   * For local sandboxes, this is a no-op.
   * For remote sandboxes, this releases resources.
   */
  stop(): Promise<void>;
}
