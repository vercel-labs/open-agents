import { deepAgent, deepAgentModelId } from "@open-harness/agent";
import type { TUIAgentCallOptions } from "./types";

// Configure your agent here - this is the single source of truth for the TUI
export const tuiAgent = deepAgent;
export const tuiAgentModelId = deepAgentModelId;
export const pasteCollapseLineThreshold = 5;

// Default agent options factory
export function createDefaultAgentOptions(
  workingDirectory: string,
): TUIAgentCallOptions {
  return {
    workingDirectory,
  };
}
