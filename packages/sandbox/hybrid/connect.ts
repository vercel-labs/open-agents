import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import { connectJustBash } from "../just-bash/connect";
import { connectVercel } from "../vercel/connect";
import { VercelSandbox } from "../vercel/sandbox";
import { configureGitUser } from "../vercel/utils";
import type { HybridHooks } from "./hooks";
import { HybridSandbox } from "./sandbox";
import type { HybridState } from "./state";

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
  /** Timeout in milliseconds for cloud sandboxes (default: 300,000 = 5 minutes) */
  timeout?: number;
  /** Ports to expose from the sandbox for dev server preview URLs */
  ports?: number[];
  /** Snapshot ID used as the base image for new cloud sandboxes */
  baseSnapshotId?: string;
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
  source: HybridState["source"],
  options: HybridConnectOptions | undefined,
  hybrid: HybridSandbox,
): void {
  if (!options?.scheduleBackgroundWork) {
    console.log(
      "[HybridSandbox] No scheduleBackgroundWork provided, skipping cloud startup",
    );
    return;
  }

  console.log("[HybridSandbox] Scheduling background cloud sandbox startup", {
    hasSource: !!source,
  });
  options.scheduleBackgroundWork(async () => {
    console.log(
      "[HybridSandbox] Background work starting - connecting to Vercel",
    );
    try {
      const cloudSandbox = await connectVercel(source ? { source } : {}, {
        env: options?.env,
        gitUser: options?.gitUser,
        hooks: options?.hooks,
        timeout: options?.timeout,
        ports: options?.ports,
        baseSnapshotId: options?.baseSnapshotId,
      });

      // Perform handoff
      console.log("[HybridSandbox] Performing handoff to cloud sandbox");
      await hybrid.performHandoff(cloudSandbox);
      console.log("[HybridSandbox] Handoff complete");

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
 * Hybrid sandboxes start with JustBash (ephemeral) and transition to
 * a cloud sandbox (persistent) via background handoff. The state determines which phase:
 *
 * - Post-handoff (sandboxId present, no files): Reconnect directly to cloud
 * - Post-handoff recovery (snapshotId present, no sandboxId, no files): Restore from snapshot
 * - Inline handoff (sandboxId + files): Cloud ready, perform handoff now
 * - Pre-handoff (files present, no sandboxId): Restore JustBash, start cloud in background
 * - Fresh start (no files, no sandboxId): Create empty JustBash, start cloud in background
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
        ports: options?.ports,
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
    const sdk = await VercelSandboxSDK.create({
      source: { type: "snapshot", snapshotId: state.snapshotId },
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
    });

    const cloudSandbox = await VercelSandbox.connect(sdk.sandboxId, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout: options?.timeout,
      ports: options?.ports,
    });

    // Configure git user if provided (not done automatically when restoring from snapshot)
    if (options?.gitUser) {
      await configureGitUser(cloudSandbox, options.gitUser);
    }

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
        ports: options?.ports,
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
    console.log("[HybridSandbox] Pre-handoff: Creating JustBash from files", {
      hasSource: !!state.source,
      hasSandboxId: !!state.sandboxId,
    });
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

    // Start cloud in background (with or without source)
    if (!state.sandboxId) {
      startCloudSandboxInBackground(state.source, options, hybrid);
    }

    return hybrid;
  }

  // Fresh start: No files - create empty JustBash and start cloud in background
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

  // Start cloud sandbox in background (with or without source)
  startCloudSandboxInBackground(state.source, options, hybrid);

  return hybrid;
}
