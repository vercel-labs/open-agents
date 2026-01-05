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
 * WARNING: This global state means the agent is NOT safe for concurrent use
 * across multiple sessions in the same process. If two `agent.stream` calls
 * run concurrently, their approval rules, mode, and workingDirectory will
 * interfere with each other. For now, ensure only one active session per
 * process, or create separate agent instances per session.
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
