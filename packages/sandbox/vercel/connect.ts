import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { SandboxHooks } from "../interface";
import type { VercelState } from "./state";
import { VercelSandbox } from "./sandbox";
import { configureGitUser } from "./utils";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
}

/**
 * Connect to a Vercel sandbox based on the provided state.
 *
 * - If `sandboxId` is present, reconnects to an existing running VM
 * - If `snapshotId` is present (without sandboxId), restores from native snapshot
 * - If `source` is present, creates a new VM and clones the repo
 * - Otherwise, creates an empty sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<VercelSandbox> {
  // Reconnect to existing VM
  if (state.sandboxId) {
    // Calculate remaining timeout from persisted expiresAt
    let remainingTimeout: number | undefined;
    if (state.expiresAt) {
      remainingTimeout = Math.max(0, state.expiresAt - Date.now());
    }

    return VercelSandbox.connect(state.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout,
    });
  }

  // Restore from snapshot (VM timed out, need to spin up new one)
  if (state.snapshotId) {
    const sdk = await VercelSandboxSDK.create({
      source: { type: "snapshot", snapshotId: state.snapshotId },
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
    });

    // Wrap in VercelSandbox - use connect since SDK is already created
    // Pass remainingTimeout so timeout tracking works correctly
    const sandbox = await VercelSandbox.connect(sdk.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout: options?.timeout,
    });

    // Configure git user if provided (not done automatically when restoring from snapshot)
    if (options?.gitUser) {
      await configureGitUser(sandbox, options.gitUser);
    }

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
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
    });
  }

  // Create empty sandbox
  return VercelSandbox.create({
    env: options?.env,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
  });
}
