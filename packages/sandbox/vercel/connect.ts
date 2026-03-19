import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { Sandbox, SandboxHooks } from "../interface";
import { tryConnectVercelSandboxDirect } from "./direct";
import { VercelSandbox } from "./sandbox";
import type { VercelState } from "./state";
import { configureGitUser } from "./utils";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  ports?: number[];
  baseSnapshotId?: string;
}

function getRemainingTimeout(
  expiresAt: number | undefined,
): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  const remaining = expiresAt - Date.now();
  return remaining > 10_000 ? remaining : undefined;
}

function canUseOptimisticAttach(options?: ConnectOptions): boolean {
  // Keep the full SDK reconnect path for callers that need ports/environment
  // details or lifecycle hooks.
  return !options?.hooks && !options?.ports;
}

/**
 * Connect to the Vercel-backed cloud sandbox based on the provided state.
 *
 * - If `sandboxId` is present, reconnects to an existing running VM
 * - If `snapshotId` is present (without sandboxId), restores from native snapshot
 * - If `source` is present, creates a new VM and prepares the repo
 * - Otherwise, creates an empty sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  // Reconnect to existing VM
  if (state.sandboxId) {
    const remainingTimeout = getRemainingTimeout(state.expiresAt);

    const connectManagedSandbox = () =>
      VercelSandbox.connect(state.sandboxId as string, {
        env: options?.env,
        hooks: options?.hooks,
        remainingTimeout,
        ports: options?.ports,
      });

    if (canUseOptimisticAttach(options)) {
      const directSandbox = await tryConnectVercelSandboxDirect({
        sandboxId: state.sandboxId,
        env: options?.env,
        reconnect: connectManagedSandbox,
        expiresAt: state.expiresAt,
      });

      if (directSandbox) {
        return directSandbox;
      }
    }

    return connectManagedSandbox();
  }

  // Restore from snapshot (VM timed out, need to spin up new one)
  if (state.snapshotId) {
    const sdk = await VercelSandboxSDK.create({
      source: { type: "snapshot", snapshotId: state.snapshotId },
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
    });

    // Wrap in VercelSandbox - use connect since SDK is already created
    // Pass remainingTimeout so timeout tracking works correctly
    const sandbox = await VercelSandbox.connect(sdk.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout: options?.timeout,
      ports: options?.ports,
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
        newBranch: state.source.newBranch,
      },
      env: options?.env,
      gitUser: options?.gitUser,
      hooks: options?.hooks,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
      ...(options?.baseSnapshotId && {
        baseSnapshotId: options.baseSnapshotId,
      }),
    });
  }

  // Create empty sandbox
  return VercelSandbox.create({
    env: options?.env,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.ports && { ports: options.ports }),
    ...(options?.baseSnapshotId && {
      baseSnapshotId: options.baseSnapshotId,
    }),
  });
}
