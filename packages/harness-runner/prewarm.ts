import { prewarmHarness } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createPi } from "@ai-sdk/harness-pi";
import type { SnapshotSandbox } from "@open-agents/sandbox/vercel";

export async function prepareHarnessSandboxRuntimeProfile(
  sandbox: SnapshotSandbox,
): Promise<void> {
  if (!sandbox.toHarnessSandboxProvider) {
    throw new Error(
      "Configured sandbox provider does not support AI SDK harness prewarming.",
    );
  }

  const sandboxProvider = sandbox.toHarnessSandboxProvider();

  await prewarmHarness({
    harness: createCodex(),
    sandboxProvider,
  });
  await prewarmHarness({
    harness: createClaudeCode(),
    sandboxProvider,
  });
  await prewarmHarness({
    harness: createPi(),
    sandboxProvider,
  });
}
