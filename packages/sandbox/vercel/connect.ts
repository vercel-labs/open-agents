import type { SandboxHooks } from "../interface";
import type { VercelState } from "./state";
import { VercelSandbox } from "./sandbox";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
}

/**
 * Connect to a Vercel sandbox based on the provided state.
 *
 * - If `sandboxId` is present, reconnects to an existing running VM
 * - If `snapshotId` is present (without sandboxId), restores from snapshot
 * - If `source` is present, creates a new VM and clones the repo
 * - Otherwise, creates an empty sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<VercelSandbox> {
  // Reconnect to existing VM
  if (state.sandboxId) {
    return VercelSandbox.connect(state.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
    });
  }

  // Restore from snapshot (VM timed out, need to spin up new one)
  if (state.snapshotId) {
    const sandbox = await VercelSandbox.create({
      env: options?.env,
      gitUser: options?.gitUser,
      hooks: options?.hooks,
    });
    await sandbox.restoreSnapshot({
      downloadUrl: state.snapshotId, // snapshotId is the download URL
    });
    return sandbox;
  }

  // Create from source
  if (state.source) {
    return VercelSandbox.create({
      source: {
        url: state.source.repo,
        branch: state.source.branch,
        token: state.source.token,
      },
      env: options?.env,
      gitUser: options?.gitUser,
      hooks: options?.hooks,
    });
  }

  // Create empty sandbox
  return VercelSandbox.create({
    env: options?.env,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
  });
}
