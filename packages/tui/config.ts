import { deepAgent, deepAgentModelId } from "@open-harness/agent";
import type { AgentMode } from "@open-harness/agent";
import type { Sandbox } from "@open-harness/sandbox";
import type { TUIAgentCallOptions } from "./types.js";

// Configure your agent here - this is the single source of truth for the TUI
export const tuiAgent = deepAgent;
export const tuiAgentModelId = deepAgentModelId;
export const pasteCollapseLineThreshold = 5;

// Default agent options factory
export function createDefaultAgentOptions(
  sandbox: Sandbox,
  mode: AgentMode = "interactive",
): TUIAgentCallOptions {
  return {
    sandbox,
    mode,
  };
}
