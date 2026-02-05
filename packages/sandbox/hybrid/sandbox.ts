/**
 * Hybrid Sandbox - Seamless handoff from ephemeral to persistent
 *
 * A sandbox wrapper that tracks pending operations on JustBash and supports
 * seamless handoff to Vercel, replaying all writes.
 *
 * Design:
 * - Wraps JustBash sandbox and tracks all write operations
 * - When Vercel is ready and handoff is triggered, replays writes to Vercel
 * - After handoff, all operations go directly to Vercel
 * - Detects commands that require Vercel (git, npm, curl, etc.)
 */

import type { Dirent } from "fs";
import type { ExecResult, Sandbox, SandboxStats } from "../interface";
import type { JustBashSandbox } from "../just-bash/sandbox";
import type { PendingOperation, SandboxStatus } from "../types";
import type { HybridState } from "./state";

/**
 * Commands that require Vercel (git, npm, network operations).
 */
const VERCEL_REQUIRED_COMMANDS = [
  // Git operations
  "git",
  // Package managers
  "npm",
  "pnpm",
  "yarn",
  "bun",
  // Network operations
  "curl",
  "wget",
  "fetch",
  // Process management
  "node",
  "python",
  "python3",
  "ruby",
  "php",
];

/**
 * Check if a command requires Vercel sandbox.
 */
export function requiresVercel(command: string): boolean {
  const trimmed = command.trim();
  return VERCEL_REQUIRED_COMMANDS.some(
    (cmd) => trimmed === cmd || trimmed.startsWith(`${cmd} `),
  );
}

export interface HybridSandboxConfig {
  /**
   * The JustBash sandbox to wrap.
   */
  justBash: Sandbox;

  /**
   * Previously tracked pending operations (for restoration across requests).
   */
  pendingOperations?: PendingOperation[];

  /**
   * Callback when a command requires Vercel but Vercel isn't ready.
   */
  onVercelRequired?: (command: string) => void;
}

/**
 * HybridSandbox wraps a JustBash sandbox and tracks writes for replay.
 *
 * Use flow:
 * 1. Create with JustBash sandbox
 * 2. Agent works on JustBash, writes are tracked
 * 3. When Vercel is ready, call `performHandoff(vercelSandbox)`
 * 4. After handoff, all operations go to Vercel
 */
export class HybridSandbox implements Sandbox {
  readonly type = "hybrid" as const;
  private _expiresAt: number | undefined;
  private _timeout: number | undefined;

  get expiresAt(): number | undefined {
    // After handoff, return Vercel's expiration
    if (this.state === "vercel" && this.vercel) {
      return this.vercel.expiresAt;
    }
    return this._expiresAt;
  }

  get timeout(): number | undefined {
    // After handoff, return Vercel's timeout
    if (this.state === "vercel" && this.vercel) {
      return this.vercel.timeout;
    }
    return this._timeout;
  }

  private justBash: Sandbox | null;
  private vercel: Sandbox | null = null;
  private _pendingOperations: PendingOperation[];
  private state: "justbash" | "switching" | "vercel" = "justbash";
  private onVercelRequired?: (command: string) => void;

  constructor(config: HybridSandboxConfig) {
    this.justBash = config.justBash;
    this._pendingOperations = config.pendingOperations ?? [];
    this.onVercelRequired = config.onVercelRequired;
    this._expiresAt = this.justBash.expiresAt;
    this._timeout = this.justBash.timeout;
  }

  /**
   * Environment details - dynamically returns the correct details based on state.
   * After handoff to Vercel, returns Vercel's environment details (with Git available).
   * Before/during handoff, returns JustBash's environment details (no Git).
   */
  get environmentDetails(): string | undefined {
    // After handoff complete, use Vercel's environment details
    if (this.state === "vercel" && this.vercel) {
      return this.vercel.environmentDetails;
    }
    // Before or during handoff, use JustBash's environment details
    return this.justBash?.environmentDetails;
  }

  /**
   * Get the current active sandbox.
   * @throws Error if neither sandbox is available (should not happen in normal operation)
   */
  private get current(): Sandbox {
    // Post-handoff or during switching with vercel available
    if (
      (this.state === "vercel" || this.state === "switching") &&
      this.vercel
    ) {
      return this.vercel;
    }
    // Pre-handoff or switching without vercel ready yet
    if (this.justBash) {
      return this.justBash;
    }
    // This should never happen in normal operation
    throw new Error(
      `HybridSandbox in invalid state: state=${this.state}, justBash=${!!this.justBash}, vercel=${!!this.vercel}`,
    );
  }

  /**
   * Working directory - returns current sandbox's path.
   */
  get workingDirectory(): string {
    return this.current.workingDirectory;
  }

  /**
   * Get the current pending operations for persistence.
   */
  get pendingOperations(): PendingOperation[] {
    return this._pendingOperations;
  }

  /**
   * Get the current sandbox state.
   */
  get sandboxState(): "justbash" | "switching" | "vercel" {
    return this.state;
  }

  /**
   * Check if handoff has been performed.
   */
  get isHandedOff(): boolean {
    return this.state === "vercel";
  }

  /**
   * Get the Vercel sandbox ID (if available after handoff).
   */
  get id(): string | undefined {
    return this.vercel && "id" in this.vercel
      ? (this.vercel.id as string)
      : undefined;
  }

  /**
   * Read a file from the current sandbox.
   */
  async readFile(path: string, encoding: "utf-8"): Promise<string> {
    return this.current.readFile(path, encoding);
  }

  /**
   * Write a file - tracks operation if on JustBash.
   */
  async writeFile(
    path: string,
    content: string,
    encoding: "utf-8",
  ): Promise<void> {
    // Track operation if on JustBash
    if (this.state === "justbash") {
      this._pendingOperations.push({ type: "writeFile", path, content });
    }
    return this.current.writeFile(path, content, encoding);
  }

  /**
   * Get file stats from the current sandbox.
   */
  async stat(path: string): Promise<SandboxStats> {
    return this.current.stat(path);
  }

  /**
   * Check file access in the current sandbox.
   */
  async access(path: string): Promise<void> {
    return this.current.access(path);
  }

  /**
   * Create a directory - tracks operation if on JustBash.
   */
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    // Track operation if on JustBash
    if (this.state === "justbash") {
      this._pendingOperations.push({
        type: "mkdir",
        path,
        recursive: options?.recursive ?? false,
      });
    }
    return this.current.mkdir(path, options);
  }

  /**
   * Read directory contents from the current sandbox.
   */
  async readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    return this.current.readdir(path, options);
  }

  /**
   * Execute a command.
   *
   * If on JustBash and command requires Vercel, triggers onVercelRequired callback.
   */
  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    // Check if command requires Vercel
    if (this.state === "justbash" && requiresVercel(command)) {
      this.onVercelRequired?.(command);
      // Return error indicating Vercel is required
      return {
        success: false,
        exitCode: 127,
        stdout: "",
        stderr: `Command '${command.split(" ")[0]}' requires Vercel sandbox. Please wait for Vercel to be ready or trigger a handoff.`,
        truncated: false,
      };
    }
    return this.current.exec(command, cwd, timeoutMs);
  }

  /**
   * Stop the current sandbox.
   */
  async stop(): Promise<void> {
    if (this.vercel) {
      await this.vercel.stop();
    }
    // Don't stop JustBash - it will be serialized for persistence
  }

  /**
   * Perform handoff from JustBash to Vercel.
   *
   * Replays all pending write operations to Vercel, then switches the active sandbox.
   *
   * @param vercelSandbox - The ready Vercel sandbox to switch to
   * @returns Object with replay results
   */
  async performHandoff(vercelSandbox: Sandbox): Promise<{
    success: boolean;
    operationsReplayed: number;
    errors: string[];
    timeMs: number;
  }> {
    const startTime = Date.now();
    const errors: string[] = [];

    this.state = "switching";
    this.vercel = vercelSandbox;

    // Replay pending operations to Vercel
    let operationsReplayed = 0;

    for (const op of this._pendingOperations) {
      try {
        if (op.type === "mkdir") {
          await vercelSandbox.mkdir(op.path, { recursive: op.recursive });
          operationsReplayed++;
        } else if (op.type === "writeFile") {
          await vercelSandbox.writeFile(op.path, op.content, "utf-8");
          operationsReplayed++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to replay ${op.type} for ${op.path}: ${message}`);
      }
    }

    // Switch to Vercel regardless of errors (some operations may fail if
    // files were created by npm install, etc.)
    this.state = "vercel";

    // Clear JustBash reference after successful handoff
    this.justBash = null;

    return {
      success: errors.length === 0,
      operationsReplayed,
      errors,
      timeMs: Date.now() - startTime,
    };
  }

  /**
   * Get the underlying JustBash sandbox for serialization.
   */
  getJustBashSandbox(): Sandbox | null {
    return this.justBash;
  }

  /**
   * Get the Vercel sandbox (if available after handoff).
   */
  getVercelSandbox(): Sandbox | null {
    return this.vercel;
  }

  /**
   * Get the current status of the sandbox.
   */
  get status(): SandboxStatus {
    if (this.state === "vercel" && this.vercel) return "ready"; // Post-handoff
    if (this.justBash) return "ready"; // Pre-handoff but usable
    return "starting";
  }

  /**
   * Get the current state for persistence.
   * Returns state that can be passed to `connectSandbox()` to restore this sandbox.
   */
  getState(): { type: "hybrid" } & HybridState {
    // Post-handoff or switching with vercel ready: return Vercel reference
    // This ensures we don't lose the vercel connection when persisting during/after handoff
    if (
      (this.state === "vercel" || this.state === "switching") &&
      this.vercel
    ) {
      const vercelId =
        "id" in this.vercel ? (this.vercel.id as string) : undefined;
      return {
        type: "hybrid",
        sandboxId: vercelId,
        expiresAt: this.vercel.expiresAt,
      };
    }

    // Pre-handoff: return full JustBash state + pending ops
    const justBashSandbox = this.justBash as JustBashSandbox | null;
    const files = justBashSandbox
      ? (
          justBashSandbox as {
            serialize?: () => { files: HybridState["files"] };
          }
        ).serialize?.()?.files
      : undefined;

    return {
      type: "hybrid",
      files,
      workingDirectory: this.justBash?.workingDirectory,
      env: this.justBash?.env,
      sandboxId:
        this.vercel && "id" in this.vercel
          ? (this.vercel.id as string)
          : undefined,
      pendingOperations:
        this._pendingOperations.length > 0
          ? this._pendingOperations
          : undefined,
      expiresAt: this.vercel?.expiresAt,
    };
  }
}
