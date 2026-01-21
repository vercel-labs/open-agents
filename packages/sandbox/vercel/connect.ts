import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { SandboxHooks } from "../interface";
import type { VercelState } from "./state";
import { VercelSandbox } from "./sandbox";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
}

/**
 * Check if a snapshot ID is a legacy blob URL (vs native snapshot ID).
 * Legacy snapshots are download URLs starting with https://
 */
function isLegacySnapshot(snapshotId: string): boolean {
  return snapshotId.startsWith("https://");
}

/**
 * Connect to a Vercel sandbox based on the provided state.
 *
 * - If `sandboxId` is present, reconnects to an existing running VM
 * - If `snapshotId` is present (without sandboxId), restores from snapshot:
 *   - Native snapshot IDs: Creates sandbox via Sandbox.create({ source: { type: 'snapshot', snapshotId } })
 *   - Legacy blob URLs: Creates empty sandbox and restores via restoreLegacySnapshot()
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
    // Check if this is a legacy blob URL or native snapshot ID
    if (isLegacySnapshot(state.snapshotId)) {
      // Legacy blob restoration: create empty sandbox and restore
      const sandbox = await VercelSandbox.create({
        env: options?.env,
        gitUser: options?.gitUser,
        hooks: options?.hooks,
      });
      await sandbox.restoreLegacySnapshot({
        downloadUrl: state.snapshotId,
      });
      return sandbox;
    }

    // Native snapshot restoration: create sandbox from snapshot directly
    const sdk = await VercelSandboxSDK.create({
      source: { type: "snapshot", snapshotId: state.snapshotId },
    });

    // Wrap in VercelSandbox - use connect since SDK is already created
    return VercelSandbox.connect(sdk.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
    });
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
