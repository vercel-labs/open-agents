import type { SandboxHooks } from "../interface";
import type { HybridState } from "./state";
import { HybridSandbox } from "./sandbox";
import { connectJustBash } from "../just-bash/connect";
import { connectVercel } from "../vercel/connect";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
}

/**
 * Connect to a Hybrid sandbox based on the provided state.
 *
 * Hybrid sandboxes start with JustBash (ephemeral) and can transition to
 * Vercel (persistent) via handoff. The state determines which phase we're in:
 *
 * - Post-handoff (sandboxId present, no files): Reconnect directly to Vercel
 * - Post-handoff recovery (snapshotId present, no sandboxId, no files): Restore from snapshot
 * - Pre-handoff (files present): Restore JustBash state with pending operations
 * - Fresh start (source present or empty): Create new JustBash sandbox
 */
export async function connectHybrid(
  state: HybridState,
  options?: ConnectOptions,
): Promise<HybridSandbox> {
  // Post-handoff: Just reconnect to Vercel
  // (sandboxId present, no files means we've already transitioned)
  if (state.sandboxId && !state.files) {
    const vercel = await connectVercel({ sandboxId: state.sandboxId }, options);
    // Create hybrid wrapper that's already in "vercel" state
    const hybrid = new HybridSandbox({
      // Create a minimal justBash for the wrapper (will be replaced immediately)
      justBash: await connectJustBash({
        workingDirectory: vercel.workingDirectory,
      }),
    });
    // Perform immediate handoff to Vercel
    await hybrid.performHandoff(vercel);
    return hybrid;
  }

  // Post-handoff recovery: VM timed out, restore from snapshot
  if (state.snapshotId && !state.sandboxId && !state.files) {
    const vercel = await connectVercel(
      { snapshotId: state.snapshotId },
      options,
    );
    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: vercel.workingDirectory,
      }),
    });
    await hybrid.performHandoff(vercel);
    return hybrid;
  }

  // Pre-handoff: Restore JustBash state with pending operations
  if (state.files) {
    const justBash = await connectJustBash(
      {
        files: state.files,
        workingDirectory: state.workingDirectory,
        env: state.env,
      },
      options,
    );

    return new HybridSandbox({
      justBash,
      pendingOperations: state.pendingOperations,
    });
  }

  // Fresh start: Create new JustBash sandbox
  // Note: Vercel booting in background should be handled by the consumer
  const justBash = await connectJustBash(
    {
      workingDirectory: state.workingDirectory,
      env: state.env,
    },
    options,
  );

  return new HybridSandbox({
    justBash,
  });
}
