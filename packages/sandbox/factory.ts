import type { Sandbox, SandboxHooks } from "./interface";
import { connectJustBash } from "./just-bash/connect";
import type { JustBashState } from "./just-bash/state";
import type { SandboxStatus } from "./types";
import { connectVercel } from "./vercel/connect";
import type { VercelState } from "./vercel/state";

// Re-export SandboxStatus from types for convenience
export type { SandboxStatus };

/**
 * Unified sandbox state type.
 * Use `type` discriminator to determine which sandbox implementation to use.
 */
export type SandboxState =
  | ({ type: "just-bash" } & JustBashState)
  | ({ type: "vercel" } & VercelState);

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
 * Configuration for connecting to a sandbox.
 * Discriminated union ensures type-safe options for each sandbox type.
 */
export type SandboxConnectConfig =
  | { state: { type: "just-bash" } & JustBashState; options?: ConnectOptions }
  | { state: { type: "vercel" } & VercelState; options?: ConnectOptions };

/**
 * Connect to a sandbox based on the provided configuration.
 *
 * This is the unified entry point for creating, restoring, or reconnecting
 * to any sandbox type. The `type` field in state determines which implementation
 * is used, and the options are type-checked accordingly.
 *
 * @param configOrState - State and options for the sandbox (new API)
 * @param legacyOptions - Runtime options (legacy API, deprecated)
 * @returns A connected sandbox instance
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
    const config = configOrState as SandboxConnectConfig;
    switch (config.state.type) {
      case "just-bash":
        return connectJustBash(config.state, config.options);
      case "vercel":
        return connectVercel(config.state, config.options);
    }
  }

  const state = configOrState as SandboxState;
  switch (state.type) {
    case "just-bash":
      return connectJustBash(state, legacyOptions);
    case "vercel":
      return connectVercel(state, legacyOptions);
  }
}
