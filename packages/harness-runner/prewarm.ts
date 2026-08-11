import { prepareHarnessSandboxTemplate } from "@ai-sdk/harness/agent";
import type { HarnessCapableSandbox } from "@open-agents/sandbox/vercel";
import { HARNESS_DEFINITIONS } from "./adapters.ts";
import { EXTERNAL_HARNESS_IDS } from "./ids.ts";

/**
 * Prepare a sandbox's runtime profile for every registered external harness
 * so production sessions resume from a warm snapshot.
 */
export async function prepareHarnessSandboxRuntimeProfile(
  sandbox: Pick<HarnessCapableSandbox, "toHarnessSandboxProvider">,
): Promise<void> {
  const sandboxProvider = sandbox.toHarnessSandboxProvider();

  for (const harnessId of EXTERNAL_HARNESS_IDS) {
    await prepareHarnessSandboxTemplate({
      harness: HARNESS_DEFINITIONS[harnessId].createAdapter(),
      sandboxProvider,
    });
  }
}
