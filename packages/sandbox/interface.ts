import type { Dirent } from "fs";

/**
 * The type of sandbox environment.
 */
export type SandboxType = "cloud";

/**
 * Result of a successful snapshot operation.
 * Uses native Vercel snapshot IDs instead of blob URLs.
 */
export interface SnapshotResult {
  /** Native Vercel snapshot ID */
  snapshotId: string;
}

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
   */
  afterStart?: SandboxHook;

  /**
   * Called before the sandbox stops.
   * Use for teardown tasks like committing uncommitted changes, cleanup, etc.
   */
  beforeStop?: SandboxHook;

  /**
   * Called when the sandbox is about to timeout (before beforeStop).
   * Use to differentiate timeout-triggered stops from manual stops.
   */
  onTimeout?: SandboxHook;

  /**
   * Called after timeout is successfully extended.
   * @param sandbox - The sandbox instance
   * @param additionalMs - How much time was added
   */
  onTimeoutExtended?: (sandbox: Sandbox, additionalMs: number) => Promise<void>;
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
 */
export interface Sandbox {
  /**
   * Identifier for the sandbox implementation type.
   * Used to conditionally adjust agent behavior.
   */
  readonly type: SandboxType;

  /**
   * The working directory for this sandbox.
   */
  readonly workingDirectory: string;

  /**
   * Environment variables available to commands in the sandbox.
   */
  readonly env?: Record<string, string>;

  /**
   * The current git branch in the sandbox (if applicable).
   */
  readonly currentBranch?: string;

  /**
   * Lifecycle hooks for this sandbox.
   */
  readonly hooks?: SandboxHooks;

  /**
   * Environment-specific details for the agent system prompt.
   */
  readonly environmentDetails?: string;

  /**
   * The base host/domain for this sandbox.
   */
  readonly host?: string;

  /**
   * Timestamp (ms since epoch) when this sandbox will be proactively stopped.
   */
  readonly expiresAt?: number;

  /**
   * The initial configured proactive timeout duration in milliseconds.
   */
  readonly timeout?: number;

  readFile(path: string, encoding: "utf-8"): Promise<string>;
  writeFile(path: string, content: string, encoding: "utf-8"): Promise<void>;
  stat(path: string): Promise<SandboxStats>;
  access(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult>;

  /**
   * Execute a shell command in detached mode (returns immediately).
   */
  execDetached?(command: string, cwd: string): Promise<{ commandId: string }>;

  /**
   * Get the public URL for an exposed port.
   */
  domain?(port: number): string;

  /**
   * Stop and clean up the sandbox.
   */
  stop(): Promise<void>;

  /**
   * Extend the sandbox timeout by the specified duration.
   */
  extendTimeout?(additionalMs: number): Promise<{ expiresAt: number }>;

  /**
   * Create a native Vercel snapshot of the sandbox filesystem.
   */
  snapshot?(): Promise<SnapshotResult>;

  /**
   * Get the current state of the sandbox for persistence/restoration.
   */
  getState?(): unknown;
}
