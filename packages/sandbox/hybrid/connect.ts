import type { HybridState } from "./state";
import type { HybridHooks } from "./hooks";
import { HybridSandbox } from "./sandbox";
import { connectJustBash } from "../just-bash/connect";
import { connectVercel } from "../vercel/connect";

/**
 * Connect options for hybrid sandbox.
 * Includes hybrid-specific hooks and background task support.
 */
export interface HybridConnectOptions {
  /** Environment variables (e.g., GITHUB_TOKEN) */
  env?: Record<string, string>;
  /** Git user for commits (cloud sandboxes only) */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks including hybrid-specific hooks */
  hooks?: HybridHooks;
  /**
   * Schedule background work for cloud sandbox startup.
   * The callback returns a promise that completes when cloud sandbox is ready.
   * Wire this to your runtime's background task mechanism:
   *
   * @example Next.js (after)
   * import { after } from 'next/server';
   * scheduleBackgroundWork: (cb) => after(cb),
   *
   * @example Vercel Functions (waitUntil)
   * import { waitUntil } from '@vercel/functions';
   * scheduleBackgroundWork: (cb) => waitUntil(cb()),
   *
   * @example Cloudflare Workers
   * scheduleBackgroundWork: (cb) => ctx.waitUntil(cb()),
   */
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

/**
 * Start cloud sandbox in background by scheduling work via callback.
 * The work is deferred until the callback is invoked by the runtime.
 */
function startCloudSandboxInBackground(
  source: NonNullable<HybridState["source"]>,
  options: HybridConnectOptions | undefined,
  hybrid: HybridSandbox,
): void {
  if (!options?.scheduleBackgroundWork) {
    return; // No background scheduler provided
  }

  options.scheduleBackgroundWork(async () => {
    try {
      const cloudSandbox = await connectVercel(
        { source },
        {
          env: options?.env,
          gitUser: options?.gitUser,
          hooks: options?.hooks,
        },
      );

      // Perform handoff
      await hybrid.performHandoff(cloudSandbox);

      // Notify consumer via hook
      const sandboxId = cloudSandbox.id;
      if (sandboxId && options?.hooks?.onCloudSandboxReady) {
        await options.hooks.onCloudSandboxReady(sandboxId, cloudSandbox);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[HybridSandbox] Cloud sandbox startup failed:", err);

      if (options?.hooks?.onCloudSandboxFailed) {
        await options.hooks.onCloudSandboxFailed(err);
      }
    }
  });
}

/**
 * Connect to a Hybrid sandbox based on the provided state.
 *
 * Hybrid sandboxes start with JustBash (ephemeral) and can transition to
 * a cloud sandbox (persistent) via handoff. The state determines which phase:
 *
 * - Post-handoff (sandboxId present, no files): Reconnect directly to cloud
 * - Post-handoff recovery (snapshotId present, no sandboxId, no files): Restore from snapshot
 * - Inline handoff (sandboxId + files): Cloud ready, perform handoff now
 * - Pre-handoff (files present, no sandboxId): Restore JustBash, optionally start cloud
 * - Fresh start (no files, no sandboxId, source present): Create empty JustBash, start cloud in background
 * - Error (no files, no sandboxId, no source): Invalid state
 */
export async function connectHybrid(
  state: HybridState,
  options?: HybridConnectOptions,
): Promise<HybridSandbox> {
  // Post-handoff: Just reconnect to cloud sandbox
  // (sandboxId present, no files means we've already transitioned)
  if (state.sandboxId && !state.files) {
    const cloudSandbox = await connectVercel(
      { sandboxId: state.sandboxId },
      {
        env: options?.env,
        hooks: options?.hooks,
      },
    );

    // Create hybrid wrapper that's already in "cloud" state
    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: cloudSandbox.workingDirectory,
      }),
    });

    await hybrid.performHandoff(cloudSandbox);
    return hybrid;
  }

  // Post-handoff recovery: Cloud sandbox timed out, restore from snapshot
  if (state.snapshotId && !state.sandboxId && !state.files) {
    const cloudSandbox = await connectVercel(
      { snapshotId: state.snapshotId },
      {
        env: options?.env,
        gitUser: options?.gitUser,
        hooks: options?.hooks,
      },
    );

    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: cloudSandbox.workingDirectory,
      }),
    });

    await hybrid.performHandoff(cloudSandbox);
    return hybrid;
  }

  // Pre-handoff but cloud ready: Perform inline handoff
  // (sandboxId + files means cloud is ready but we haven't switched yet)
  if (state.sandboxId && state.files) {
    const cloudSandbox = await connectVercel(
      { sandboxId: state.sandboxId },
      {
        env: options?.env,
        hooks: options?.hooks,
      },
    );

    // Replay pending operations
    const pendingOps = state.pendingOperations ?? [];
    const errors: string[] = [];

    for (const op of pendingOps) {
      try {
        if (op.type === "mkdir") {
          await cloudSandbox.mkdir(op.path, { recursive: op.recursive });
        } else if (op.type === "writeFile") {
          await cloudSandbox.writeFile(op.path, op.content, "utf-8");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to replay ${op.type} for ${op.path}: ${message}`);
      }
    }

    if (errors.length > 0) {
      console.warn(
        `[HybridSandbox] Inline handoff replay errors (${errors.length}/${pendingOps.length}):`,
        errors,
      );
    }

    // Create hybrid in post-handoff state
    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: cloudSandbox.workingDirectory,
      }),
    });

    await hybrid.performHandoff(cloudSandbox);
    return hybrid;
  }

  // Pre-handoff: Create/restore JustBash from files
  if (state.files) {
    const justBash = await connectJustBash(
      {
        files: state.files,
        workingDirectory: state.workingDirectory,
        env: state.env,
      },
      {
        env: options?.env,
        hooks: options?.hooks,
      },
    );

    const hybrid = new HybridSandbox({
      justBash,
      pendingOperations: state.pendingOperations,
    });

    // If source provided and no sandboxId yet, start cloud in background
    if (state.source && !state.sandboxId) {
      startCloudSandboxInBackground(state.source, options, hybrid);
    }

    return hybrid;
  }

  // Fresh start: No files but source provided - create empty JustBash and start cloud
  if (state.source) {
    const justBash = await connectJustBash(
      {
        workingDirectory: state.workingDirectory,
        env: state.env,
      },
      {
        env: options?.env,
        hooks: options?.hooks,
      },
    );

    const hybrid = new HybridSandbox({
      justBash,
    });

    // Start cloud sandbox in background
    startCloudSandboxInBackground(state.source, options, hybrid);

    return hybrid;
  }

  // Invalid state: no files and no sandboxId and no source
  throw new Error(
    "Invalid HybridState: requires either 'files' for ephemeral mode, 'sandboxId' for cloud mode, or 'source' to start cloud in background",
  );
}
