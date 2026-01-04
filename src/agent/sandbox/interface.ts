import type { Dirent } from "fs";

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
