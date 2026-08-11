import type { HarnessAgentAdapter } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createPi } from "@ai-sdk/harness-pi";
import { EXTERNAL_HARNESS_IDS, type ExternalHarnessId } from "./ids.ts";

export interface HarnessDefinition {
  /** Human-readable name used in model-facing instructions. */
  displayName: string;
  /**
   * Create the harness adapter. `modelId` is the already-resolved model id
   * (see `resolveHarnessModelId`); omit it to use the harness default, for
   * example when prewarming a sandbox runtime profile.
   */
  createAdapter: (modelId?: string) => HarnessAgentAdapter;
  /**
   * AI Gateway provider prefix this harness understands natively. Model ids
   * carrying the prefix are passed through without it; ids from other
   * providers resolve to undefined so the harness falls back to its default
   * model. Harnesses without a prefix receive the full gateway model id.
   */
  gatewayModelIdPrefix?: string;
  /**
   * Provider-metadata key whose object carries a cumulative `costUsd` for
   * this harness. Undefined when the harness does not report cost.
   */
  costMetadataKey?: string;
  /**
   * Model-facing phrase naming the todo tool in the shared instructions'
   * task-tracking line (lets Claude Code steer away from its built-in
   * TodoWrite tool).
   */
  todoWriteToolPhrase: string;
  /** Harness-specific instruction lines appended after the shared base. */
  instructionExtras: readonly string[];
  /**
   * Built-in harness tools disabled for this harness. Claude Code's native
   * AskUserQuestion is replaced by the Open Agents ask_user_question client
   * tool; the framework maps these names to the runtime's `disallowedTools`.
   */
  inactiveTools?: readonly string[];
}

/**
 * Registry of everything harness-specific. Keyed by `ExternalHarnessId`, so
 * adding an id to `ids.ts` forces a definition here.
 */
export const HARNESS_DEFINITIONS: Record<ExternalHarnessId, HarnessDefinition> =
  {
    codex: {
      displayName: "Codex",
      createAdapter: (modelId) => createCodex({ model: modelId }),
      gatewayModelIdPrefix: "openai/",
      todoWriteToolPhrase: "todo_write",
      instructionExtras: [
        "Do not say that the structured question tool is unavailable. If Codex exposes user-defined tools through MCP, use the harness-tools MCP tool. If the MCP namespace is not visible, use the custom-tool relay command shown in the prompt for ask_user_question.",
      ],
    },
    "claude-code": {
      displayName: "Claude Code",
      createAdapter: (modelId) => createClaudeCode({ model: modelId }),
      gatewayModelIdPrefix: "anthropic/",
      costMetadataKey: "claude-code",
      todoWriteToolPhrase: "todo_write instead of your built-in TodoWrite tool",
      instructionExtras: [],
      inactiveTools: ["AskUserQuestion"],
    },
    pi: {
      displayName: "Pi",
      createAdapter: (modelId) => createPi({ model: modelId }),
      todoWriteToolPhrase: "todo_write",
      instructionExtras: [],
    },
  };

/** Registry-derived view kept for callers that only need the tool lists. */
export const HARNESS_INACTIVE_TOOLS: Partial<
  Record<ExternalHarnessId, readonly string[]>
> = Object.fromEntries(
  EXTERNAL_HARNESS_IDS.flatMap((harnessId) => {
    const inactiveTools = HARNESS_DEFINITIONS[harnessId].inactiveTools;
    return inactiveTools ? [[harnessId, inactiveTools] as const] : [];
  }),
);

/**
 * Resolve an AI Gateway model id (`provider/model`) to what the harness
 * expects: prefix-scoped harnesses get the bare model id for their own
 * provider and their default model (undefined) otherwise; prefix-less
 * harnesses get the full gateway id unchanged.
 */
export function resolveHarnessModelId(
  harnessId: ExternalHarnessId,
  modelId: string,
): string | undefined {
  const prefix = HARNESS_DEFINITIONS[harnessId].gatewayModelIdPrefix;
  if (prefix === undefined) {
    return modelId;
  }
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : undefined;
}

export function createHarnessAdapter(
  harnessId: ExternalHarnessId,
  modelId: string,
): HarnessAgentAdapter {
  return HARNESS_DEFINITIONS[harnessId].createAdapter(
    resolveHarnessModelId(harnessId, modelId),
  );
}
