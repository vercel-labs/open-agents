import { connectHybrid } from "./hybrid/connect";
import type { HybridHooks } from "./hybrid/hooks";
import type { HybridState } from "./hybrid/state";
import type { Sandbox, SandboxHooks } from "./interface";
import { connectJustBash } from "./just-bash/connect";
import type { JustBashState } from "./just-bash/state";
import { connectVercel } from "./vercel/connect";
import type { VercelState } from "./vercel/state";

// Re-export SandboxStatus from types for convenience
export type { SandboxStatus } from "./types";

/**
 * Unified sandbox state type.
 * Use `type` discriminator to determine which sandbox implementation to use.
 */
export type SandboxState =
  | ({ type: "just-bash" } & JustBashState)
  | ({ type: "vercel" } & VercelState)
  | ({ type: "hybrid" } & HybridState);

/**
 * Base connect options for all sandbox types.
 */
export interface ConnectOptions {
  /** Environment variables (e.g., GITHUB_TOKEN) */
  env?: Record<string, string>;
  /** Git user for commits (cloud sandboxes only) */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
  /** Timeout in milliseconds for cloud sandboxes (default: 300,000 = 5 minutes) */
  timeout?: number;
  /** Ports to expose from the sandbox for dev server preview URLs */
  ports?: number[];
  /** Snapshot ID used as the base image for new cloud sandboxes */
  baseSnapshotId?: string;
}

/**
 * Connect options with hybrid-specific hooks and background task support.
 */
export interface HybridConnectOptions extends Omit<ConnectOptions, "hooks"> {
  /** Environment variables (e.g., GITHUB_TOKEN) */
  env?: Record<string, string>;
  /** Git user for commits */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks including hybrid-specific hooks */
  hooks?: HybridHooks;
  /** Ports to expose from the sandbox for dev server preview URLs */
  ports?: number[];
  /** Snapshot ID used as the base image for new cloud sandboxes */
  baseSnapshotId?: string;
  /**
   * Schedule background work for cloud sandbox startup.
   * Wire to your runtime's background task mechanism.
   *
   * @example Next.js: `(cb) => after(cb)`
   * @example Vercel: `(cb) => waitUntil(cb())`
   */
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

/**
 * Configuration for connecting to a sandbox.
 * Discriminated union ensures type-safe options for each sandbox type.
 */
export type SandboxConnectConfig =
  | { state: { type: "just-bash" } & JustBashState; options?: ConnectOptions }
  | { state: { type: "vercel" } & VercelState; options?: ConnectOptions }
  | { state: { type: "hybrid" } & HybridState; options?: HybridConnectOptions };

/**
 * Connect to a sandbox based on the provided configuration.
 *
 * This is the unified entry point for creating, restoring, or reconnecting
 * to any sandbox type. The `type` field in state determines which implementation
 * is used, and the options are type-checked accordingly.
 *
 * @param config - State and options for the sandbox (new API)
 * @param options - Runtime options (legacy API, deprecated)
 * @returns A connected sandbox instance
 *
 * @example
 * // New API: Config object with state and options
 * const sandbox = await connectSandbox({
 *   state: {
 *     type: "hybrid",
 *     files: extractedFiles,
 *     workingDirectory: "/workspace",
 *     source: { repo: "https://github.com/owner/repo", branch: "main" },
 *   },
 *   options: {
 *     env: { GITHUB_TOKEN: token },
 *     scheduleBackgroundWork: (cb) => after(cb),
 *     hooks: {
 *       onCloudSandboxReady: async (sandboxId) => {
 *         await persistState({ type: "hybrid", sandboxId });
 *       },
 *     },
 *   },
 * });
 *
 * @example
 * // Legacy API: State and options as separate arguments (still supported)
 * const sandbox = await connectSandbox(
 *   { type: "vercel", sandboxId: "sbx-abc123" },
 *   { env: { GITHUB_TOKEN: token } }
 * );
 */
export async function connectSandbox(
  configOrState: SandboxConnectConfig | SandboxState,
  legacyOptions?: ConnectOptions,
): Promise<Sandbox> {
  // Detect if using new config API or legacy (state, options) API
  const isNewApi =
    typeof configOrState === "object" &&
    "state" in configOrState &&
    typeof configOrState.state === "object" &&
    "type" in configOrState.state;

  if (isNewApi) {
    // New API: { state, options }
    const config = configOrState as SandboxConnectConfig;
    switch (config.state.type) {
      case "just-bash":
        return connectJustBash(config.state, config.options);
      case "vercel":
        return connectVercel(config.state, config.options);
      case "hybrid":
        return connectHybrid(config.state, config.options);
    }
  } else {
    // Legacy API: (state, options) as separate arguments
    const state = configOrState as SandboxState;
    switch (state.type) {
      case "just-bash":
        return connectJustBash(state, legacyOptions);
      case "vercel":
        return connectVercel(state, legacyOptions);
      case "hybrid":
        return connectHybrid(state, legacyOptions);
    }
  }
}
