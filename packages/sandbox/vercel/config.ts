import type { SandboxHooks } from "../interface";

export interface VercelSandboxConfig {
  /**
   * Optional GitHub repository source to clone into the sandbox.
   * If not provided, the sandbox starts empty.
   */
  source?: {
    /** GitHub repository URL (e.g., "https://github.com/owner/repo") */
    url: string;
    /** Branch to clone (defaults to "main") */
    branch?: string;
    /** Token for authenticated git access (e.g., GitHub PAT). Enables push operations. */
    token?: string;
    /**
     * Create and checkout a new branch after cloning.
     * Useful for isolating agent changes from the main branch.
     */
    newBranch?: string;
  };
  /**
   * Git user configuration for commits.
   * Required if you want the agent to make commits.
   */
  gitUser?: {
    /** Name for git commits (e.g., "AI Agent") */
    name: string;
    /** Email for git commits (e.g., "agent@example.com") */
    email: string;
  };
  /**
   * Environment variables to make available to all commands in the sandbox.
   * Useful for API keys, tokens, and other secrets.
   */
  env?: Record<string, string>;
  /**
   * Number of vCPUs (1-8). Each vCPU provides 2048 MB of memory.
   * @default 4
   */
  vcpus?: number;
  /**
   * Sandbox timeout in milliseconds.
   * @default 300_000 (5 minutes)
   */
  timeout?: number;
  /**
   * Runtime environment.
   * @default "node22"
   */
  runtime?: "node22" | "node24" | "python3.13";
  /**
   * Ports to expose from the sandbox.
   */
  ports?: number[];
  /**
   * Optional snapshot ID to use as the base image for new sandboxes.
   * When provided, the sandbox is created from this snapshot first.
   */
  baseSnapshotId?: string;
  /**
   * Lifecycle hooks for setup and teardown.
   * afterStart is called after the sandbox is created and configured.
   * beforeStop is called before the sandbox is stopped.
   */
  hooks?: SandboxHooks;
}

/**
 * Configuration for reconnecting to an existing sandbox.
 */
export interface VercelSandboxConnectConfig {
  /** The sandbox ID to reconnect to */
  sandboxId: string;
  /** Environment variables to make available to commands */
  env?: Record<string, string>;
  /** Lifecycle hooks for setup and teardown */
  hooks?: SandboxHooks;
  /**
   * Remaining timeout in milliseconds for this sandbox.
   * If not provided, defaults to 5 minutes (DEFAULT_RECONNECT_TIMEOUT_MS).
   * This ensures proactive stop and hooks (beforeStop, onTimeout) work correctly.
   * Provide an explicit value if you know the exact remaining time.
   */
  remainingTimeout?: number;
}
