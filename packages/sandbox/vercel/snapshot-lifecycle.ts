import { connectSandbox, type SandboxConnectConfig } from "../factory.ts";
import type { ExecResult, SnapshotResult } from "../interface.ts";
import type { AiSdkHarnessSandboxProvider } from "./harness-provider.ts";

/**
 * Minimal sandbox surface required to prepare a filesystem and snapshot it.
 */
export interface SnapshotSandbox {
  workingDirectory: string;
  exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult>;
  stop(): Promise<void>;
  snapshot?(): Promise<SnapshotResult>;
  toHarnessSandboxProvider?(
    bridgePorts?: ReadonlyArray<number>,
  ): AiSdkHarnessSandboxProvider;
}

export type SnapshotSandboxConnector = (
  config: SandboxConnectConfig,
) => Promise<SnapshotSandbox>;

export type SnapshotLog = (message: string) => void;

export function defaultConnectSnapshotSandbox(
  config: SandboxConnectConfig,
): Promise<SnapshotSandbox> {
  return connectSandbox(config);
}

export function resolveSnapshotLog(log?: SnapshotLog): SnapshotLog {
  return log ?? (() => {});
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RunSnapshotLifecycleOptions<T> {
  log: SnapshotLog;
  /** Connect to the sandbox that will be prepared and snapshotted. */
  connect: () => Promise<SnapshotSandbox>;
  /** Caller-specific preparation, run after snapshot support is verified. */
  prepare: (sandbox: SnapshotSandbox) => Promise<T>;
  /** Log line emitted right before the snapshot is created. */
  creatingSnapshotMessage: string;
  /** Log prefix used when stopping the sandbox after a failure also fails. */
  stopFailureMessage: string;
}

interface SnapshotLifecycleResult<T> {
  snapshotId: string;
  prepared: T;
}

/**
 * Shared connect -> verify snapshot support -> prepare -> snapshot lifecycle.
 *
 * On success the snapshot call stops the sandbox itself, so no explicit stop
 * happens. On any failure before the snapshot exists, the sandbox is stopped
 * explicitly; stop errors are logged and swallowed so the original failure
 * still surfaces.
 */
export async function runSnapshotLifecycle<T>(
  options: RunSnapshotLifecycleOptions<T>,
): Promise<SnapshotLifecycleResult<T>> {
  let sandbox: SnapshotSandbox | null = null;
  let snapshotCreated = false;

  try {
    sandbox = await options.connect();

    if (!sandbox.snapshot) {
      throw new Error(
        "Configured sandbox provider does not support snapshots.",
      );
    }

    const prepared = await options.prepare(sandbox);

    options.log(options.creatingSnapshotMessage);
    const snapshot = await sandbox.snapshot();
    snapshotCreated = true;
    options.log(`Created snapshot ${snapshot.snapshotId}.`);

    return { snapshotId: snapshot.snapshotId, prepared };
  } finally {
    if (sandbox && !snapshotCreated) {
      try {
        await sandbox.stop();
      } catch (error) {
        options.log(`${options.stopFailureMessage}: ${toErrorMessage(error)}`);
      }
    }
  }
}
