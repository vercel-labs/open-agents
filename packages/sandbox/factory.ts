import type { Sandbox, SandboxHooks } from "./interface";
import type { JustBashState } from "./just-bash/state";
import type { VercelState } from "./vercel/state";
import type { HybridState } from "./hybrid/state";
import { connectJustBash } from "./just-bash/connect";
import { connectVercel } from "./vercel/connect";
import { connectHybrid } from "./hybrid/connect";

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
 * Runtime options for connecting to a sandbox.
 * These are not persisted - they're provided at connect time.
 */
export interface ConnectOptions {
  /** Environment variables (e.g., GITHUB_TOKEN) */
  env?: Record<string, string>;
  /** Git user for commits (Vercel only) */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
}

/**
 * Connect to a sandbox based on the provided state.
 *
 * This is the unified entry point for creating, restoring, or reconnecting
 * to any sandbox type. The `type` field in state determines which implementation
 * is used, and the remaining fields configure how to connect.
 *
 * @param state - Persisted state (from DB or fresh config)
 * @param options - Runtime options like env vars and hooks (not persisted)
 *
 * @example
 * // Fresh just-bash
 * const sandbox = await connectSandbox({
 *   type: "just-bash",
 * });
 *
 * @example
 * // Reconnect to existing Vercel VM with env vars
 * const sandbox = await connectSandbox(
 *   { type: "vercel", sandboxId: "sbx-abc123" },
 *   { env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } }
 * );
 *
 * @example
 * // Restore from saved state
 * const savedState = await db.load(taskId);
 * const sandbox = await connectSandbox(savedState.sandboxState, {
 *   env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
 * });
 */
export async function connectSandbox(
  state: SandboxState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  switch (state.type) {
    case "just-bash":
      return connectJustBash(state, options);
    case "vercel":
      return connectVercel(state, options);
    case "hybrid":
      return connectHybrid(state, options);
  }
}
