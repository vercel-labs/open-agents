import type { ApprovalConfig } from "@open-harness/agent";
import { openHarnessAgent } from "@open-harness/agent";
import type { Sandbox } from "@open-harness/sandbox";
import type { TUIAgentCallOptions } from "./types";

// Configure your agent here - this is the single source of truth for the TUI
export const tuiAgent = openHarnessAgent;
export const pasteCollapseLineThreshold = 5;

// Default approval config for interactive mode
const defaultApprovalConfig: ApprovalConfig = {
  type: "interactive",
  autoApprove: "off",
  sessionRules: [],
};

// Default agent options factory
export function createDefaultAgentOptions(
  sandbox: Sandbox,
  approval: ApprovalConfig = defaultApprovalConfig,
): TUIAgentCallOptions {
  return {
    sandbox,
    approval,
  };
}
