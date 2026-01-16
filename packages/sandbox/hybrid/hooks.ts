import type { Sandbox, SandboxHooks } from "../interface";

/**
 * Hooks specific to hybrid sandbox lifecycle.
 * Extends base SandboxHooks with hybrid-specific events.
 */
export interface HybridHooks extends SandboxHooks {
  /**
   * Called when the cloud sandbox becomes ready during hybrid mode.
   * Use this to persist the sandboxId for future reconnection.
   *
   * This hook is called asynchronously after connectSandbox returns.
   * The hybrid sandbox is usable immediately; this hook fires when
   * the background cloud sandbox startup completes.
   *
   * @param sandboxId - The ID of the ready cloud sandbox
   * @param sandbox - The cloud sandbox instance
   *
   * @example
   * onCloudSandboxReady: async (sandboxId) => {
   *   await updateTask(taskId, {
   *     sandboxState: { type: "hybrid", sandboxId },
   *   });
   * }
   */
  onCloudSandboxReady?: (sandboxId: string, sandbox: Sandbox) => Promise<void>;

  /**
   * Called if cloud sandbox background startup fails.
   * The hybrid sandbox continues working with the ephemeral sandbox.
   *
   * @param error - The error that occurred during cloud sandbox startup
   *
   * @example
   * onCloudSandboxFailed: async (error) => {
   *   console.error("Cloud sandbox failed:", error);
   *   // Optionally notify user or retry
   * }
   */
  onCloudSandboxFailed?: (error: Error) => Promise<void>;
}
