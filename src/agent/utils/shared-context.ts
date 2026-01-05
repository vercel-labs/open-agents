import type { AgentMode, AutoApprove, ApprovalRule } from "../types";

/**
 * Mutable global state shared between prepareCall and tool approval functions.
 *
 * This exists because the AI SDK's `needsApproval` callback only receives tool
 * arguments, not `experimental_context`. Since approval functions need access
 * to `workingDirectory` and `mode` to make decisions (e.g., auto-approve in
 * background mode, check if paths are within working directory), we use this
 * global as a workaround.
 *
 * TODO: Remove this once the AI SDK passes context to `needsApproval` functions.
 * At that point, approval functions can read from `experimental_context` directly.
 */
export const sharedContext: {
  workingDirectory: string;
  mode: AgentMode;
  autoApprove: AutoApprove;
  approvalRules: ApprovalRule[];
} = {
  workingDirectory: process.cwd(),
  mode: "interactive",
  autoApprove: "off",
  approvalRules: [],
};
