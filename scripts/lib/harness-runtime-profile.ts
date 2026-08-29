import { prepareHarnessSandboxRuntimeProfile } from "@open-agents/harness-runner";
import type { SnapshotSandbox } from "@open-agents/sandbox/vercel";

/**
 * Prepare the external harness runtime profile on a snapshot sandbox.
 * `SnapshotSandbox` exposes `toHarnessSandboxProvider` optionally, while the
 * harness runner requires it, so guard before delegating.
 */
export async function prepareSnapshotSandboxRuntimeProfile(
  sandbox: SnapshotSandbox,
): Promise<void> {
  const toHarnessSandboxProvider =
    sandbox.toHarnessSandboxProvider?.bind(sandbox);
  if (!toHarnessSandboxProvider) {
    throw new Error(
      "Configured sandbox does not support harness sandbox providers.",
    );
  }

  await prepareHarnessSandboxRuntimeProfile({ toHarnessSandboxProvider });
}
