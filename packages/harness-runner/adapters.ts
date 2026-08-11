import type { HarnessAgentAdapter } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createPi } from "@ai-sdk/harness-pi";

export const EXTERNAL_HARNESS_IDS = ["codex", "claude-code", "pi"] as const;

export type ExternalHarnessId = (typeof EXTERNAL_HARNESS_IDS)[number];

export function isExternalHarnessId(
  value: unknown,
): value is ExternalHarnessId {
  return (
    typeof value === "string" &&
    EXTERNAL_HARNESS_IDS.includes(value as ExternalHarnessId)
  );
}

export function resolveCodexModelId(modelId: string): string | undefined {
  return modelId.startsWith("openai/")
    ? modelId.slice("openai/".length)
    : undefined;
}

export function resolveClaudeCodeModelId(modelId: string): string | undefined {
  return modelId.startsWith("anthropic/")
    ? modelId.slice("anthropic/".length)
    : undefined;
}

export function resolvePiModelId(modelId: string): string {
  return modelId;
}

/**
 * Built-in harness tools disabled per harness. Claude Code's native
 * AskUserQuestion is replaced by the Open Agents ask_user_question client
 * tool; the framework maps these names to the runtime's `disallowedTools`.
 */
export const HARNESS_INACTIVE_TOOLS: Partial<
  Record<ExternalHarnessId, readonly string[]>
> = {
  "claude-code": ["AskUserQuestion"],
};

export function createHarnessAdapter(
  harnessId: ExternalHarnessId,
  modelId: string,
): HarnessAgentAdapter {
  switch (harnessId) {
    case "codex":
      return createCodex({ model: resolveCodexModelId(modelId) });
    case "claude-code":
      return createClaudeCode({
        model: resolveClaudeCodeModelId(modelId),
      });
    case "pi":
      return createPi({ model: resolvePiModelId(modelId) });
    default: {
      const exhausted: never = harnessId;
      throw new Error(`Unsupported harness: ${String(exhausted)}`);
    }
  }
}
